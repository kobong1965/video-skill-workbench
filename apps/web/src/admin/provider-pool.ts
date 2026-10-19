import type { PublicProvider } from '../workspace';

export type ProviderKind = 'text' | 'image';
export interface ProviderDraft {
  id: string; name: string; enabled: boolean; baseUrl: string; model: string; apiKey: string;
  vision: boolean; references: boolean; multiReference: boolean; timeoutSeconds: number;
  jsonMode: boolean; outputHosts: string; maxConcurrency: number; hasKey: boolean; activeJobs: number;
}

export function providerDraft(provider: PublicProvider, kind: ProviderKind, index = 0, singleUser = false): ProviderDraft {
  return {
    id: provider.id || (index === 0 ? `legacy-${kind}` : `legacy-${kind}-${index}`),
    name: provider.name || (kind === 'text' ? '默认文字接口' : '默认图片接口'),
    enabled: provider.enabled, baseUrl: provider.baseUrl || '', model: provider.model || '', apiKey: '',
    vision: provider.vision ?? (kind === 'text' && singleUser), references: provider.references ?? false,
    multiReference: provider.multiReference ?? false, timeoutSeconds: provider.timeoutSeconds ?? (singleUser ? 0 : 120),
    jsonMode: provider.jsonMode ?? true, outputHosts: (provider.outputHosts || []).join(', '),
    maxConcurrency: provider.maxConcurrency ?? 4, hasKey: provider.hasKey, activeJobs: provider.activeJobs ?? 0,
  };
}

/** A blank password means preserve the stored key for this exact id. Never serialize display-only fields. */
export function providerPayload(draft: ProviderDraft, kind: ProviderKind, singleUser = false) {
  return {
    id: draft.id, name: draft.name.trim(), enabled: draft.enabled, protocol: 'openai-compatible' as const,
    baseUrl: draft.baseUrl.trim(), model: draft.model.trim(),
    ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    vision: singleUser && kind === 'text' ? true : draft.vision,
    references: draft.references, multiReference: draft.multiReference,
    timeoutSeconds: draft.timeoutSeconds, jsonMode: draft.jsonMode, maxConcurrency: draft.maxConcurrency,
    outputHosts: draft.outputHosts.split(',').map(host => host.trim()).filter(Boolean),
  };
}

export function freshProvider(kind: ProviderKind, number: number, singleUser = false): ProviderDraft {
  return providerDraft({ id: crypto.randomUUID(), name: `${kind === 'text' ? '文字' : '图片'}接口 ${number}`,
    enabled: true, configured: false, hasKey: false, maxConcurrency: 4 }, kind, number - 1, singleUser);
}

/** Pool-aware readiness: an explicitly empty pool must never revive a legacy provider. */
export function textProviderReady(providers: PublicProvider[] | undefined, legacy: PublicProvider, singleUser: boolean) {
  return (providers ?? [legacy]).some(provider => provider.enabled && provider.configured && (singleUser || provider.vision === true));
}
