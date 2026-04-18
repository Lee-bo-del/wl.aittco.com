//const BACKEND_URL = 'http://localhost:3002';
// 自动判断环境：本地开发用 3323，线上部署用相对路径// 自动判断环境
const BACKEND_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3325'
  : '';

interface ReversePromptResponse {
    success: boolean;
    prompt?: string;
    error?: string;
}

/**
 * 将文件转换为 Base64 字符串
 */
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
};

/**
 * 调用后端 API 进行图片逆推提示词
 * @param apiKey 用户的 API Key
 * @param imageFile 上传的图片文件
 * @returns 逆推生成的提示词
 */
export async function reversePrompt(apiKey: string, imageFile: File): Promise<string> {
    if (!apiKey) {
        throw new Error('API Key 不能为空');
    }
    if (!imageFile) {
        throw new Error('请先选择图片');
    }

    // 验证文件类型
    if (!imageFile.type.startsWith('image/')) {
        throw new Error('请上传有效的图片文件');
    }

    // 验证文件大小 (例如限制 4MB, Gemini API 有限制)
    if (imageFile.size > 4 * 1024 * 1024) {
        throw new Error('图片大小不能超过 4MB');
    }

    try {
        const base64Image = await fileToBase64(imageFile);

        const response = await fetch(`${BACKEND_URL}/api/reverse-prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ image: base64Image })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `请求失败: ${response.status}`);
        }

        const data: ReversePromptResponse = await response.json();

        if (!data.success || !data.prompt) {
            throw new Error(data.error || '逆推失败：未返回结果');
        }

        return data.prompt;
    } catch (error: any) {
        if (error.message.includes('fetch')) {
            throw new Error('连接失败：请确保后端服务正在运行 (端口 3325)');
        }
        throw error;
    }
}
