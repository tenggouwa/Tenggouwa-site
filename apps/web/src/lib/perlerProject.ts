import type { BeadColor, FilterOptions } from './perlerPattern';

export interface SavedPerlerProject {
  id: string;
  savedAt: number;
  fileName: string;
  imageDataUrl: string;
  gridWidth: number;
  gridHeight: number;
  colorCount: number;
  fitMode: 'cover' | 'contain';
  cropX: number;
  cropY: number;
  cropZoom: number;
  filters: FilterOptions;
  cartoonize: boolean;
  cartoonStrength: number;
  paletteName: string;
  customPalette: BeadColor[];
  stockOnly: boolean;
  numbers: boolean;
}

const DB_NAME = 'tenggouwa-perler';
const STORE_NAME = 'projects';
const LATEST_ID = 'latest';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLatestPerlerProject(project: Omit<SavedPerlerProject, 'id' | 'savedAt'>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ ...project, id: LATEST_ID, savedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function loadLatestPerlerProject(): Promise<SavedPerlerProject | null> {
  const db = await openDb();
  const project = await new Promise<SavedPerlerProject | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(LATEST_ID);
    request.onsuccess = () => resolve((request.result as SavedPerlerProject | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return project;
}
