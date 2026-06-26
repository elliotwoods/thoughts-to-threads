// Lazy Firebase Admin init. db() returns an init-once Firestore singleton so
// `next build` never constructs a client at module top level.

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { firebaseConfig } from "./env";

let app: App | undefined;
let firestore: Firestore | undefined;

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }
  const cfg = firebaseConfig();
  app = initializeApp({
    credential: cert({
      projectId: cfg.projectId,
      clientEmail: cfg.clientEmail,
      privateKey: cfg.privateKey,
    }),
    projectId: cfg.projectId,
  });
  return app;
}

export function db(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getAdminApp());
  return firestore;
}
