import { appDb } from './appDb.js';
import {
  LOUVAIN_JOB_NAME,
  buildDeterministicClusterId,
  findBestOverlappingCluster,
  getSchedulerJobRunState,
  getSybilCluster,
  getSybilClusterMembers,
  normalizeClusterMembers,
  setSchedulerJobRunState,
  upsertSybilClusterWithMembers,
} from './sybilClusterStore.js';

const LOUVAIN_EDGE_LIMIT = 10_000;
const LOUVAIN_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_COMMUNITY_SIZE = 3;

const selectFundingEdgesForCommunities = appDb.prepare(`
  SELECT
    from_address,
    to_address,
    total_amount,
    tx_count,
    last_seen_at
  FROM sybil_funding_edges
  WHERE last_seen_at >= ?
  ORDER BY tx_count DESC, total_amount DESC, last_seen_at DESC
  LIMIT ?
`);

function loadFundingGraphRows(limit = LOUVAIN_EDGE_LIMIT, now = Date.now()) {
  const cutoff = now - LOUVAIN_LOOKBACK_MS;
  return selectFundingEdgesForCommunities.all(cutoff, limit);
}

function buildWeightedGraph(rows) {
  const nodeSet = new Set();
  const edgeMap = new Map();

  for (const row of rows) {
    const source = String(row.from_address ?? '').trim();
    const target = String(row.to_address ?? '').trim();
    if (!source || !target || source === target) continue;

    const weight = Math.max(0, Number(row.total_amount) || 0);
    if (weight <= 0) continue;

    nodeSet.add(source);
    nodeSet.add(target);

    const edgeKey = source < target ? `${source}|${target}` : `${target}|${source}`;
    const existing = edgeMap.get(edgeKey);
    if (existing) {
      existing.weight += weight;
      existing.txCount += Math.max(0, Number(row.tx_count) || 0);
    } else {
      edgeMap.set(edgeKey, {
        source: source < target ? source : target,
        target: source < target ? target : source,
        weight,
        txCount: Math.max(0, Number(row.tx_count) || 0),
      });
    }
  }

  const adjacency = new Map();
  for (const node of nodeSet) adjacency.set(node, []);
  for (const edge of edgeMap.values()) {
    adjacency.get(edge.source)?.push({ node: edge.target, weight: edge.weight });
    adjacency.get(edge.target)?.push({ node: edge.source, weight: edge.weight });
  }

  return {
    nodes: [...nodeSet].sort((left, right) => left.localeCompare(right)),
    edges: [...edgeMap.values()],
    adjacency,
  };
}

function groupAssignments(assignments) {
  const grouped = new Map();
  for (const [node, label] of Object.entries(assignments || {})) {
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(node);
  }
  return [...grouped.values()]
    .map((members) => normalizeClusterMembers(members))
    .filter((members) => members.length >= MIN_COMMUNITY_SIZE);
}

async function detectCommunitiesWithLouvain(graphData) {
  const graphologyModule = await import('graphology');
  const louvainModule = await import('graphology-communities-louvain');

  const GraphCtor = graphologyModule.UndirectedGraph
    || graphologyModule.default?.UndirectedGraph
    || graphologyModule.default
    || graphologyModule.Graph;
  if (typeof GraphCtor !== 'function') {
    throw new Error('graphology UndirectedGraph unavailable');
  }

  const graph = new GraphCtor();
  for (const node of graphData.nodes) {
    if (!graph.hasNode(node)) graph.addNode(node);
  }
  for (const edge of graphData.edges) {
    graph.addEdge(edge.source, edge.target, { weight: edge.weight });
  }

  const runLouvain = louvainModule.default || louvainModule.louvain || louvainModule;
  let assignments = null;
  if (typeof runLouvain === 'function') {
    assignments = runLouvain(graph, { getEdgeWeight: 'weight' });
  } else if (typeof louvainModule.detailed === 'function') {
    assignments = louvainModule.detailed(graph, { getEdgeWeight: 'weight' })?.communities ?? null;
  }

  if (!assignments || typeof assignments !== 'object') {
    throw new Error('Louvain assignment output unavailable');
  }

  return {
    algorithm: 'louvain',
    communities: groupAssignments(assignments),
  };
}

function detectCommunitiesWithLabelPropagation(graphData, maxIterations = 20) {
  const labels = new Map(graphData.nodes.map((node) => [node, node]));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = 0;
    for (const node of graphData.nodes) {
      const neighbors = graphData.adjacency.get(node) || [];
      if (!neighbors.length) continue;

      const scores = new Map();
      for (const neighbor of neighbors) {
        const label = labels.get(neighbor.node) || neighbor.node;
        scores.set(label, (scores.get(label) || 0) + neighbor.weight);
      }

      let bestLabel = labels.get(node) || node;
      let bestScore = -1;
      for (const [label, score] of scores.entries()) {
        if (score > bestScore || (score === bestScore && String(label).localeCompare(String(bestLabel)) < 0)) {
          bestLabel = label;
          bestScore = score;
        }
      }

      if (bestLabel !== labels.get(node)) {
        labels.set(node, bestLabel);
        changed += 1;
      }
    }

    if (changed === 0) break;
  }

  return {
    algorithm: 'label_propagation',
    communities: groupAssignments(Object.fromEntries(labels)),
  };
}

async function detectCommunities(graphData) {
  try {
    return await detectCommunitiesWithLouvain(graphData);
  } catch (error) {
    console.warn(`[sybil-louvain] Falling back to label propagation: ${error.message}`);
    return detectCommunitiesWithLabelPropagation(graphData);
  }
}

function calculateCommunityConfidence(members, graphData) {
  if (!Array.isArray(members) || members.length < MIN_COMMUNITY_SIZE) return 0;
  const memberSet = new Set(members);
  let internalWeight = 0;
  let internalEdges = 0;

  for (const edge of graphData.edges) {
    if (memberSet.has(edge.source) && memberSet.has(edge.target)) {
      internalWeight += edge.weight;
      internalEdges += 1;
    }
  }

  const possibleEdges = (members.length * (members.length - 1)) / 2;
  const density = possibleEdges > 0 ? internalEdges / possibleEdges : 0;
  const avgWeight = internalEdges > 0 ? internalWeight / internalEdges : 0;
  const sizeScore = Math.min(1, members.length / 10);
  const weightScore = Math.min(1, avgWeight / 10);
  return Number(Math.min(0.95, (density * 0.4) + (sizeScore * 0.35) + (weightScore * 0.25)).toFixed(4));
}

function getMsUntilNextLouvainWindow(now = Date.now()) {
  const nextRun = new Date(now);
  nextRun.setUTCMinutes(0, 0, 0);
  nextRun.setUTCHours(4);
  if (nextRun.getTime() <= now) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }
  return Math.max(0, nextRun.getTime() - now);
}

function getLouvainCommunityDetectionState() {
  return getSchedulerJobRunState(LOUVAIN_JOB_NAME);
}

async function runLouvainCommunityDetection({ reason = 'scheduled', now = Date.now() } = {}) {
  const rows = loadFundingGraphRows(LOUVAIN_EDGE_LIMIT, now);
  if (!rows.length) {
    const summary = {
      reason,
      algorithm: 'none',
      edgeCount: 0,
      totalCommunities: 0,
      newClusters: 0,
      mergedClusters: 0,
    };
    setSchedulerJobRunState(LOUVAIN_JOB_NAME, {
      lastRunAt: now,
      lastStatus: 'ok',
      summary,
    });
    console.log('[sybil-louvain] No funding edges available for community detection');
    return summary;
  }

  const graphData = buildWeightedGraph(rows);
  const detection = await detectCommunities(graphData);
  let newClusters = 0;
  let mergedClusters = 0;

  for (const members of detection.communities) {
    if (members.length < MIN_COMMUNITY_SIZE) continue;

    const confidence = calculateCommunityConfidence(members, graphData);
    const overlap = findBestOverlappingCluster(members, 0.5);

    if (overlap) {
      const existingMembers = getSybilClusterMembers(overlap.clusterId);
      const mergedMembers = normalizeClusterMembers([...existingMembers, ...members]);
      if (mergedMembers.length >= MIN_COMMUNITY_SIZE) {
        upsertSybilClusterWithMembers({
          clusterId: overlap.clusterId,
          members: mergedMembers,
          detectionMethod: overlap.detectionMethod || 'louvain',
          confidence: Math.max(overlap.confidence || 0, confidence),
          detectedAt: overlap.detectedAt || now,
          lastUpdatedAt: now,
        });
        mergedClusters += 1;
      }
      continue;
    }

    const clusterId = buildDeterministicClusterId(members);
    if (!clusterId) continue;

    const existed = Boolean(getSybilCluster(clusterId));
    upsertSybilClusterWithMembers({
      clusterId,
      members,
      detectionMethod: 'louvain',
      confidence,
      detectedAt: now,
      lastUpdatedAt: now,
    });
    if (!existed) newClusters += 1;
  }

  const summary = {
    reason,
    algorithm: detection.algorithm,
    edgeCount: graphData.edges.length,
    nodeCount: graphData.nodes.length,
    totalCommunities: detection.communities.length,
    newClusters,
    mergedClusters,
  };

  setSchedulerJobRunState(LOUVAIN_JOB_NAME, {
    lastRunAt: now,
    lastStatus: 'ok',
    summary,
  });

  console.log(
    `[sybil-louvain] communities=${summary.totalCommunities} new=${summary.newClusters} merged=${summary.mergedClusters} algorithm=${summary.algorithm}`
  );

  return summary;
}

export {
  LOUVAIN_EDGE_LIMIT,
  getLouvainCommunityDetectionState,
  getMsUntilNextLouvainWindow,
  runLouvainCommunityDetection,
};
