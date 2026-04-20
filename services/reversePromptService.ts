import {
  getAuthorizedBillingHeaders,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';

const BACKEND_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3325'
    : '';

interface ReversePromptResponse {
  success: boolean;
  prompt?: string;
  error?: string;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });

export async function reversePrompt(imageFile: File): Promise<string> {
  if (!imageFile) {
    throw new Error('请先选择图片');
  }
  if (!getStoredAuthSessionToken()) {
    throw new Error('请先登录后再使用图片反推');
  }

  if (!imageFile.type.startsWith('image/')) {
    throw new Error('请上传有效的图片文件');
  }

  if (imageFile.size > 4 * 1024 * 1024) {
    throw new Error('图片大小不能超过 4MB');
  }

  try {
    const base64Image = await fileToBase64(imageFile);
    const billingHeaders = await getAuthorizedBillingHeaders();
    const response = await fetch(`${BACKEND_URL}/api/reverse-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...billingHeaders,
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `请求失败: ${response.status}`);
    }

    const data: ReversePromptResponse = await response.json();
    if (!data.success || !data.prompt) {
      throw new Error(data.error || '反推失败：未返回结果');
    }
    return data.prompt;
  } catch (error: any) {
    if (String(error?.message || '').includes('fetch')) {
      throw new Error('连接失败，请确认后端服务正在运行');
    }
    throw error;
  }
}
