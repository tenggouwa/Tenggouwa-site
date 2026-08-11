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
  backgroundSimplify: boolean;
  backgroundThreshold: number;
  edgeOutline: boolean;
  paletteName: string;
  customPalette: BeadColor[];
  stockOnly: boolean;
  numbers: boolean;
  projectName: string;
}

const DB_NAME = 'tenggouwa-perler';
const STORE_NAME = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePerlerProject(project: Omit<SavedPerlerProject, 'id' | 'savedAt'> & Partial<Pick<SavedPerlerProject, 'id'>>): Promise<SavedPerlerProject> {
  const db = await openDb();
  const saved: SavedPerlerProject = { ...project, id: project.id ?? crypto.randomUUID(), savedAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(saved);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return saved;
}

export async function listPerlerProjects(): Promise<SavedPerlerProject[]> {
  const db = await openDb();
  const projects = await new Promise<SavedPerlerProject[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as SavedPerlerProject[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return projects.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deletePerlerProject(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
