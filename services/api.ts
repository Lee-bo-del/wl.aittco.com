import {
  buildBillingIdentityHeaders,
  getAuthorizedBillingHeaders,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';
import {
  allowsDirectUserApiKeyImageRoute,
  getImageRouteById,
} from '../src/config/imageRoutes';
import { formatPoint } from '../src/utils/pointFormat';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3325/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

const sanitizeHeader = (value: string) => value.replace(/[^\x00-\x7F]/g, '').trim();

const buildAuthHeaders = (apiKey?: string | null): Record<string, string> => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return {};

  const authorization = sanitizeHeader(
    trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}`,
  );

  return authorization ? { Authorization: authorization } : {};
};

const buildOptionalSessionHeaders = (): Record<string, string> => {
  const sessionToken = getStoredAuthSessionToken();
  return sessionToken ? buildBillingIdentityHeaders(sessionToken) : {};
};

const shouldBypassBillingWithUserApiKey = (apiKey: string | undefined, payload: any) => {
  const trimmedApiKey = String(apiKey || '').trim();
  if (!trimmedApiKey) return false;

  const routeId = String(payload?.routeId || '').trim();
  if (!routeId) return false;

  return allowsDirectUserApiKeyImageRoute(getImageRouteById(routeId));
};

const buildImageRequestHeaders = async (
  apiKey: string | undefined,
  payload: any,
): Promise<Record<string, string>> => {
  const billingHeaders = shouldBypassBillingWithUserApiKey(apiKey, payload)
    ? buildOptionalSessionHeaders()
    : await getAuthorizedBillingHeaders();

  return {
    ...billingHeaders,
    ...buildAuthHeaders(apiKey),
    'Content-Type': 'application/json',
  };
};

export const getModelBySize = (size: string): string => {
  switch (size.toLowerCase()) {
    case '4k':
      return 'nano-banana-2-4k';
    case '2k':
      return 'nano-banana-2-2k';
    case '1k':
    default:
      return 'nano-banana-2';
  }
};

export interface TaskStatusResponse {
  id: string;
  status: string;
  state?: string;
  output?: any;
  data?: any;
  [key: string]: any;
}

export function findAllUrlsInObject(obj: any, results: string[] = []) {
  if (!obj) return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => findAllUrlsInObject(item, results));
    return;
  }

  if (typeof obj !== 'object') return;

  if (
    obj.output &&
    typeof obj.output === 'string' &&
    (obj.output.startsWith('http') || obj.output.startsWith('data:'))
  ) {
    results.push(obj.output);
  } else if (
    obj.url &&
    typeof obj.url === 'string' &&
    (obj.url.startsWith('http') || obj.url.startsWith('data:'))
  ) {
    results.push(obj.url);
  } else if (
    obj.image_url &&
    typeof obj.image_url === 'string' &&
    (obj.image_url.startsWith('http') || obj.image_url.startsWith('data:'))
  ) {
    results.push(obj.image_url);
  }

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'object') {
      findAllUrlsInObject(value, results);
    }
  });
}

const handleApiError = async (response: Response, fallbackMessage: string) => {
  const rawText = await response.text();
  let errJson: any = null;

  try {
    errJson = JSON.parse(rawText);
  } catch {
    errJson = null;
  }

  const rawError = errJson?.error?.message || errJson?.error || rawText;
  const lowerErr = String(rawError).toLowerCase();

  if (errJson?.code === 'INSUFFICIENT_POINTS') {
    const currentPoints = formatPoint(errJson?.currentPoints ?? 0);
    const requiredPoints = formatPoint(errJson?.requiredPoints ?? 0);
    throw new Error(`点数不足：当前 ${currentPoints} 点，需要 ${requiredPoints} 点`);
  }

  if (errJson?.code === 'AUTH_LOGIN_REQUIRED') {
    throw new Error('请先登录后再使用点数功能');
  }

  if (errJson?.code === 'ACCOUNT_AUTH_REQUIRED') {
    throw new Error('账户验证失败，请重新登录');
  }

  if (
    lowerErr.includes('pre_consume_token_quota_failed') ||
    lowerErr.includes('pre-consume')
  ) {
    throw new Error('上游账户预扣额度失败，请联系管理员');
  }

  if (
    lowerErr.includes('token quota is not enough') ||
    lowerErr.includes('insufficient balance') ||
    lowerErr.includes('not enough balance') ||
    lowerErr.includes('quota')
  ) {
    throw new Error('额度不足，请充值后重试');
  }

  if (response.status === 401) {
    throw new Error('请求未授权，请先确认登录状态或 API Key');
  }

  throw new Error(
    errJson?.error?.message || errJson?.error || `${fallbackMessage} (${response.status})`,
  );
};

export const generateImageApi = async (
  apiKey: string | undefined,
  payload: any,
): Promise<{ taskId: string; url?: string; data?: any[]; images?: string[] }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/generate`, {
    method: 'POST',
    headers: await buildImageRequestHeaders(apiKey, payload),
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, '提交失败');
  }

  const resJson = await response.json();

  if (resJson.url || resJson.image_url) {
    return { taskId: '', url: resJson.url || resJson.image_url };
  }

  if (Array.isArray(resJson.images) && resJson.images.length > 0) {
    return { taskId: '', images: resJson.images, ...resJson };
  }

  const taskId = resJson.id || resJson.task_id || resJson.data?.task_id;
  if (!taskId && !resJson.url) {
    throw new Error('No task id or image url returned from API');
  }

  return { taskId: taskId || '', ...resJson };
};

export const editImageApi = async (
  apiKey: string | undefined,
  payload: any,
): Promise<{ taskId: string }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/edit`, {
    method: 'POST',
    headers: await buildImageRequestHeaders(apiKey, payload),
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, '重绘失败');
  }

  const resJson = await response.json();
  const taskId = resJson.id || resJson.task_id || resJson.data?.task_id;
  if (!taskId) {
    throw new Error('No task id returned from API');
  }

  return { taskId };
};

export const getTaskStatusApi = async (
  apiKey: string | undefined,
  taskId: string,
): Promise<TaskStatusResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/task/${taskId}`, {
    method: 'GET',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Polling HTTP error: ${response.status}`);
  }

  return response.json();
};

export const checkTaskStatus = getTaskStatusApi;

export const checkVideoTaskStatus = async (
  apiKey: string | undefined,
  taskId: string,
): Promise<TaskStatusResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/video/task/${taskId}`, {
    method: 'GET',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Video polling HTTP error: ${response.status}`);
  }

  return response.json();
};

export interface GeminiGeneratePayload {
  prompt: string;
  images?: string[];
  aspect_ratio?: string;
  image_size?: string;
  thinking_level?: string;
  output_format?: string;
}

export interface GeminiGenerateResponse {
  success: boolean;
  images: string[];
  text?: string;
  error?: string;
  data?: any[];
}

export const generateGeminiImage = async (
  apiKey: string | undefined,
  payload: GeminiGeneratePayload,
): Promise<GeminiGenerateResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/gemini/generate`, {
    method: 'POST',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...(await getAuthorizedBillingHeaders()),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, '生成失败');
  }

  return response.json();
};
