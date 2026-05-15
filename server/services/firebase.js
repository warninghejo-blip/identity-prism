import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';

let db = null;
let firebaseAvailable = false;

const initFirebase = () => {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT
    || path.join(process.cwd(), 'server', 'firebase-service-account.json');

  if (!fs.existsSync(saPath)) {
    console.warn('[firebase] Service account not found, running in JSON-only mode');
    return;
  }
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    firebaseAvailable = true;
    console.log('[firebase] Firestore connected');
  } catch (err) {
    console.warn('[firebase] Init failed, running in JSON-only mode:', err.message);
  }
};

const getDb = () => db;
const isAvailable = () => firebaseAvailable;

const setDoc = async (collection, docId, data) => {
  if (!db) return;
  try {
    await db.collection(collection).doc(docId).set(data, { merge: true });
  } catch (err) {
    console.warn(`[firebase] setDoc ${collection}/${docId} failed:`, err.message);
  }
};

const getDoc = async (collection, docId) => {
  if (!db) return null;
  try {
    const snap = await db.collection(collection).doc(docId).get();
    return snap.exists ? snap.data() : null;
  } catch (err) {
    console.warn(`[firebase] getDoc ${collection}/${docId} failed:`, err.message);
    return null;
  }
};

const getAllDocs = async (collection) => {
  if (!db) return new Map();
  try {
    const snap = await db.collection(collection).get();
    const map = new Map();
    snap.forEach(doc => map.set(doc.id, doc.data()));
    return map;
  } catch (err) {
    console.warn(`[firebase] getAllDocs ${collection} failed:`, err.message);
    return new Map();
  }
};

const batchSet = async (collection, entries) => {
  if (!db || entries.length === 0) return;
  // Firestore batch limit: 500 ops
  for (let i = 0; i < entries.length; i += 450) {
    const batch = db.batch();
    const chunk = entries.slice(i, i + 450);
    for (const [id, data] of chunk) {
      batch.set(db.collection(collection).doc(id), data, { merge: true });
    }
    await batch.commit();
  }
};

export { initFirebase, getDb, isAvailable, setDoc, getDoc, getAllDocs, batchSet };
