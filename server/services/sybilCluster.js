function createSybilClusterService({ fs, sybilGraphFile }) {
  const sybilGraph = { nodes: {}, flaggedClusters: [] };

  try {
    if (fs.existsSync(sybilGraphFile)) {
      const raw = JSON.parse(fs.readFileSync(sybilGraphFile, 'utf8'));
      if (raw.nodes) Object.assign(sybilGraph.nodes, raw.nodes);
      if (raw.flaggedClusters) sybilGraph.flaggedClusters = raw.flaggedClusters;
      console.log(`[sybil-graph] Loaded ${Object.keys(sybilGraph.nodes).length} nodes, ${sybilGraph.flaggedClusters.length} clusters`);
    }
  } catch (error) {
    console.warn('[sybil-graph] Failed to load:', error.message);
  }

  const MAX_SYBIL_GRAPH_NODES = 10_000;
  const GRAPH_NODE_TTL_MS = 90 * 24 * 3600_000;

  function pruneSybilGraph() {
    const nodeAddrs = Object.keys(sybilGraph.nodes);
    if (nodeAddrs.length > MAX_SYBIL_GRAPH_NODES) {
      const sorted = nodeAddrs.sort((a, b) => (sybilGraph.nodes[a].lastSeen || 0) - (sybilGraph.nodes[b].lastSeen || 0));
      const toRemove = sorted.slice(0, nodeAddrs.length - MAX_SYBIL_GRAPH_NODES);
      for (const addr of toRemove) delete sybilGraph.nodes[addr];
    }
    const clusterTtl = 90 * 24 * 3600_000;
    const nowPrune = Date.now();
    sybilGraph.flaggedClusters = sybilGraph.flaggedClusters.filter((cluster) =>
      cluster.lastSeen && (nowPrune - cluster.lastSeen) < clusterTtl
    );
    if (sybilGraph.flaggedClusters.length > 1000) {
      sybilGraph.flaggedClusters = sybilGraph.flaggedClusters.slice(-1000);
    }
  }

  async function saveSybilGraph() {
    pruneSybilGraph();
    try {
      const tmp = sybilGraphFile + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(sybilGraph), 'utf8');
      await fs.promises.rename(tmp, sybilGraphFile);
    } catch (error) {
      console.warn('[sybil-graph] Save failed:', error.message);
    }
  }

  function updateSybilGraphNode(address, data) {
    const existing = sybilGraph.nodes[address] || {};
    sybilGraph.nodes[address] = {
      ...existing,
      ...data,
      lastSeen: Date.now(),
    };
  }

  function checkGraphForKnownSybils(address, fundingSources, siblings) {
    let graphRisk = 0;
    const graphDetails = [];
    const now = Date.now();
    for (const funder of fundingSources) {
      const node = sybilGraph.nodes[funder];
      if (node && node.riskScore >= 50 && (now - (node.lastSeen || 0)) < GRAPH_NODE_TTL_MS) {
        graphRisk += 15;
        graphDetails.push(`Funded by flagged wallet ${funder.slice(0, 8)}... (risk ${node.riskScore})`);
      }
    }
    let flaggedSiblings = 0;
    for (const sibling of siblings) {
      const node = sybilGraph.nodes[sibling];
      if (node && node.riskScore >= 50 && (now - (node.lastSeen || 0)) < GRAPH_NODE_TTL_MS) flaggedSiblings++;
    }
    if (flaggedSiblings >= 2) {
      graphRisk += 10;
      graphDetails.push(`${flaggedSiblings} sibling wallets previously flagged as sybil`);
    }
    for (const cluster of sybilGraph.flaggedClusters) {
      if (cluster.members.includes(address)) {
        graphRisk += 20;
        graphDetails.push(`Part of flagged cluster "${cluster.label}" (${cluster.members.length} members)`);
        break;
      }
    }
    return { graphRisk: Math.min(40, graphRisk), graphDetails };
  }

  return {
    sybilGraph,
    pruneSybilGraph,
    saveSybilGraph,
    updateSybilGraphNode,
    checkGraphForKnownSybils,
  };
}

export { createSybilClusterService };
