import {
  getAuthorizedBillingHeaders,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';

const BACKEND_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3325'
    : '';

export interface PromptOption {
  style: string;
  prompt: string;
}

export interface OptimizePromptResponse {
  success: boolean;
  options?: PromptOption[];
  error?: string;
}

export async function optimizePrompt(
  prompt: string,
  type: 'IMAGE' | 'VIDEO' = 'IMAGE',
): Promise<PromptOption[]> {
  if (!prompt.trim()) {
    throw new Error('请先输入提示词');
  }
  if (!getStoredAuthSessionToken()) {
    throw new Error('请先登录后再使用提示词优化');
  }

  try {
    const billingHeaders = await getAuthorizedBillingHeaders();
    const response = await fetch(`${BACKEND_URL}/api/optimize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...billingHeaders,
      },
      body: JSON.stringify({ prompt: prompt.trim(), type }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `请求失败: ${response.status}`);
    }

    const data: OptimizePromptResponse = await response.json();
    if (!data.success || !data.options || data.options.length === 0) {
      throw new Error(data.error || '优化失败：未返回结果');
    }

    return data.options;
  } catch (error: any) {
    if (String(error?.message || '').includes('fetch')) {
      throw new Error('连接失败，请确认后端服务正在运行');
    }
    throw error;
  }
}
