/** Helper fetch client (JSON) pour les routes API. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: { code: string; message: string; details?: { field: string; message: string }[] } | null;
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: { code: string; message: string; details?: { field: string; message: string }[] } })
      | null;

    if (!res.ok) {
      const err =
        json && 'error' in json && json.error
          ? json.error
          : { code: 'http', message: `Erreur ${res.status}` };
      return { ok: false, status: res.status, data: null, error: err };
    }
    return { ok: true, status: res.status, data: json as T, error: null };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: 'network', message: 'Connexion impossible. Vérifiez votre réseau.' },
    };
  }
}
