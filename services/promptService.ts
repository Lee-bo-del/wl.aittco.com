/**
 * Prompt Optimization Service
 * 调用 Gemini API 优化用户输入的提示词，生成多个 Nano Banana Pro 格式的方案
 */

//const BACKEND_URL = 'http://localhost:3002';
// 自动判断环境：本地开发用 3325，线上部署用相对路径
const BACKEND_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
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

/**
 * 优化提示词
 * @param apiKey - API Key
 * @param prompt - 用户输入的原始提示词
 * @param type - 优化类型 ('IMAGE' | 'VIDEO'), 默认 'IMAGE'
 * @returns 优化后的提示词方案数组
 */
export async function optimizePrompt(apiKey: string, prompt: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE'): Promise<PromptOption[]> {
  if (!apiKey || !prompt.trim()) {
    throw new Error('API Key 和提示词不能为空');
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/optimize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ prompt: prompt.trim(), type })
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
    if (error.message.includes('fetch')) {
      throw new Error('连接失败：请确保后端服务正在运行 (端口 3325)');
    }
    throw error;
  }
}

