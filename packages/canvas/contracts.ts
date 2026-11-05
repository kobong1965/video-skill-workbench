export interface CanvasConnection { available: boolean; connected: boolean; version?: string; accountName?: string; error?: string; }
export interface CanvasProjects {
  projects: { id: string; name: string; workspaceId?: string }[];
  workspaces: { id: string; name: string }[]; total: number;
}
export interface CanvasImportStep {
  key: string; label: string; status: 'pending' | 'running' | 'succeeded'; nodeKey?: string;
}
/** Frozen identity only; never original paths, account credentials or the media ledger. */
export interface CanvasProductBinding {
  groupNumber: number; selectionId: string; productUid: string;
  category: 'men' | 'women'; sku: string; name: string;
  shopName: string; market: 'US'; productId: string;
  sourceHash: string; sourceUpdatedAt: string; selectedAt: string;
}
export interface CanvasImportInfo {
  id: string; taskId: string; resultId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
  progress: number; projectId: string | null; projectUrl: string | null; error: string | null;
  steps: CanvasImportStep[]; createdAt: string; updatedAt: string;
  productBindings?: CanvasProductBinding[];
}
