import crypto from 'node:crypto';
import { appDb } from './appDb.js';

const LOUVAIN_JOB_NAME = 'louvain-community-detection';

const insertOrUpdateClusterRow = appDb.prepare(`
  INSERT INTO sybil_clusters (
    cluster_id,
    size,
    detection_method,
    confidence,
    detected_at,
    last_updated_at
  ) VALUES (
    @cluster_id,
    @size,
    @detection_method,
    @confidence,
    @detected_at,
    @last_updated_at
  )
  ON CONFLICT(cluster_id) DO UPDATE SET
    size = MAX(COALESCE(sybil_clusters.size, 0), excluded.size),
    confidence = MAX(COALESCE(sybil_clusters.confidence, 0), excluded.confidence),
    last_updated_at = MAX(COALESCE(sybil_clusters.last_updated_at, 0), excluded.last_updated_at)
`);

const insertClusterMemberRow = appDb.prepare(`
  INSERT INTO sybil_cluster_members (cluster_id, address)
  VALUES (?, ?)
  ON CONFLICT(cluster_id, address) DO NOTHING
`);

const countClusterMembersRow = appDb.prepare(`
  SELECT COUNT(*) AS count
  FROM sybil_cluster_members
  WHERE cluster_id = ?
`);

const refreshClusterMetadataRow = appDb.prepare(`
  UPDATE sybil_clusters
  SET size = ?,
      confidence = MAX(COALESCE(confidence, 0), ?),
      last_updated_at = MAX(COALESCE(last_updated_at, 0), ?),
      detected_at = CASE
        WHEN detected_at IS NULL OR detected_at = 0 THEN ?
        ELSE MIN(detected_at, ?)
      END
  WHERE cluster_id = ?
`);

const selectClusterRow = appDb.prepare(`
  SELECT cluster_id, size, detection_method, confidence, detected_at, last_updated_at
  FROM sybil_clusters
  WHERE cluster_id = ?
`);

const selectClusterMembersById = appDb.prepare(`
  SELECT address
  FROM sybil_cluster_members
  WHERE cluster_id = ?
  ORDER BY address ASC
`);

const selectSchedulerJobRunRow = appDb.prepare(`
  SELECT job_name, last_run_at, last_status, summary_json, updated_at
  FROM scheduler_job_runs
  WHERE job_name = ?
`);

const upsertSchedulerJobRunRow = appDb.prepare(`
  INSERT INTO scheduler_job_runs (
    job_name,
    last_run_at,
    last_status,
    summary_json,
    updated_at
  ) VALUES (
    @job_name,
    @last_run_at,
    @last_status,
    @summary_json,
    @updated_at
  )
  ON CONFLICT(job_name) DO UPDATE SET
    last_run_at = excluded.last_run_at,
    last_status = excluded.last_status,
    summary_json = excluded.summary_json,
    updated_at = excluded.updated_at
`);

function normalizeClusterMembers(members = []) {
  return [...new Set(
    members
      .map((member) => String(member ?? '').trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function buildDeterministicClusterId(members = []) {
  const normalizedMembers = normalizeClusterMembers(members);
  if (normalizedMembers.length < 3) return null;
  return crypto.createHash('sha256')
    .update(normalizedMembers.join('|'))
    .digest('hex')
    .slice(0, 24);
}

const upsertSybilClusterWithMembers = appDb.transaction(({
  clusterId,
  members,
  detectionMethod,
  confidence = 0,
  detectedAt = Date.now(),
  lastUpdatedAt = detectedAt,
}) => {
  const normalizedMembers = normalizeClusterMembers(members);
  if (!clusterId || normalizedMembers.length < 3) return null;

  insertOrUpdateClusterRow.run({
    cluster_id: clusterId,
    size: normalizedMembers.length,
    detection_method: detectionMethod,
    confidence: Math.max(0, Math.min(0.95, Number(confidence) || 0)),
    detected_at: Math.max(0, Math.round(Number(detectedAt) || Date.now())),
    last_updated_at: Math.max(0, Math.round(Number(lastUpdatedAt) || Date.now())),
  });

  for (const address of normalizedMembers) {
    insertClusterMemberRow.run(clusterId, address);
  }

  const actualSize = Number(countClusterMembersRow.get(clusterId)?.count) || normalizedMembers.length;
  refreshClusterMetadataRow.run(
    actualSize,
    Math.max(0, Math.min(0.95, Number(confidence) || 0)),
    Math.max(0, Math.round(Number(lastUpdatedAt) || Date.now())),
    Math.max(0, Math.round(Number(detectedAt) || Date.now())),
    Math.max(0, Math.round(Number(detectedAt) || Date.now())),
    clusterId
  );

  return getSybilCluster(clusterId);
});

function getSybilCluster(clusterId) {
  const row = selectClusterRow.get(clusterId);
  if (!row) return null;
  return {
    clusterId: row.cluster_id,
    size: Number(row.size) || 0,
    detectionMethod: row.detection_method || null,
    confidence: Number(row.confidence) || 0,
    detectedAt: Number(row.detected_at) || 0,
    lastUpdatedAt: Number(row.last_updated_at) || 0,
  };
}

function getSybilClusterMembers(clusterId) {
  return selectClusterMembersById.all(clusterId).map((row) => row.address).filter(Boolean);
}

function findBestOverlappingCluster(members, threshold = 0.5) {
  const normalizedMembers = normalizeClusterMembers(members);
  if (normalizedMembers.length < 3) return null;

  const placeholders = normalizedMembers.map(() => '?').join(', ');
  const rows = appDb.prepare(`
    SELECT
      scm.cluster_id,
      COUNT(*) AS overlap_count,
      MAX(sc.size) AS cluster_size,
      MAX(sc.confidence) AS confidence,
      MAX(sc.detected_at) AS detected_at,
      MAX(sc.last_updated_at) AS last_updated_at,
      MAX(sc.detection_method) AS detection_method
    FROM sybil_cluster_members scm
    JOIN sybil_clusters sc
      ON sc.cluster_id = scm.cluster_id
    WHERE scm.address IN (${placeholders})
    GROUP BY scm.cluster_id
    ORDER BY overlap_count DESC, cluster_size DESC, last_updated_at DESC
  `).all(...normalizedMembers);

  for (const row of rows) {
    const overlapCount = Number(row.overlap_count) || 0;
    const overlapRatio = normalizedMembers.length > 0 ? overlapCount / normalizedMembers.length : 0;
    if (overlapRatio <= threshold) continue;
    return {
      clusterId: row.cluster_id,
      overlapCount,
      overlapRatio,
      size: Number(row.cluster_size) || 0,
      confidence: Number(row.confidence) || 0,
      detectedAt: Number(row.detected_at) || 0,
      lastUpdatedAt: Number(row.last_updated_at) || 0,
      detectionMethod: row.detection_method || null,
    };
  }

  return null;
}

function getSchedulerJobRunState(jobName) {
  const row = selectSchedulerJobRunRow.get(jobName);
  if (!row) return null;
  let summary = null;
  try {
    summary = row.summary_json ? JSON.parse(row.summary_json) : null;
  } catch {
    summary = null;
  }
  return {
    jobName: row.job_name,
    lastRunAt: Number(row.last_run_at) || 0,
    lastStatus: row.last_status || null,
    summary,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function setSchedulerJobRunState(jobName, { lastRunAt = 0, lastStatus = null, summary = null } = {}) {
  const now = Date.now();
  upsertSchedulerJobRunRow.run({
    job_name: jobName,
    last_run_at: Math.max(0, Math.round(Number(lastRunAt) || 0)),
    last_status: lastStatus,
    summary_json: summary ? JSON.stringify(summary) : null,
    updated_at: now,
  });
  return getSchedulerJobRunState(jobName);
}

export {
  LOUVAIN_JOB_NAME,
  buildDeterministicClusterId,
  findBestOverlappingCluster,
  getSchedulerJobRunState,
  getSybilCluster,
  getSybilClusterMembers,
  normalizeClusterMembers,
  setSchedulerJobRunState,
  upsertSybilClusterWithMembers,
};
