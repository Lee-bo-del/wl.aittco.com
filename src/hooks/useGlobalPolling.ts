import { useQueries } from '@tanstack/react-query';
import { useCanvasStore } from '../store/canvasStore';
import { checkTaskStatus, checkVideoTaskStatus, findAllUrlsInObject } from '../services/api';
import { useEffect, useMemo, useRef } from 'react';
import { useToast } from '../context/ToastContext';

export const useGlobalPolling = (
  apiKey: string | undefined,
  onUpdateGeneration: (id: string, src: string | null, error?: string) => void,
  onUpdateProgress: (id: string, progress: number) => void
) => {
  const nodes = useCanvasStore((state) => state.nodes);
  const { error: toastError } = useToast();

  // Filter nodes that need polling (loading + has taskId)
  const pendingNodes = nodes.filter(n => n.loading && n.taskId && !n.error);
  const pendingTasks = useMemo(() => {
    const map = new Map<string, typeof pendingNodes[number]>();
    for (const node of pendingNodes) {
      if (!node.taskId) continue;
      if (!map.has(node.taskId)) {
        map.set(node.taskId, node);
      }
    }
    return Array.from(map.values());
  }, [pendingNodes]);

  const queries = useQueries({
    queries: pendingTasks.map(node => ({
      // Important: cache by taskId only. Multiple nodes may intentionally share one taskId.
      queryKey: ['task', node.taskId],
      queryFn: async () => {
        if (!node.taskId) return null;
        if (node.type === 'VIDEO' && !apiKey) return null;
        try {
            const data = node.type === 'VIDEO'
                ? await checkVideoTaskStatus(apiKey, node.taskId)
                : await checkTaskStatus(apiKey, node.taskId);
            let statusRaw = (data.status || data.state || "").toUpperCase();

            // Deep search for status (same logic as before)
            if (!statusRaw || statusRaw === "UNKNOWN") {
                const findStatusInObject = (obj: any): string | null => {
                    if (!obj || typeof obj !== 'object') return null;
                    if (obj.status && typeof obj.status === 'string') return obj.status;
                    if (obj.state && typeof obj.state === 'string') return obj.state;
                    if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
                    return null;
                };
                const inner = findStatusInObject(data);
                if (inner) statusRaw = inner.toUpperCase();
            }

            const isSuccess = statusRaw === 'SUCCESS' || statusRaw === 'SUCCEEDED' || statusRaw === 'COMPLETED';
            const isFailed =
              statusRaw === 'FAILURE' ||
              statusRaw === 'FAILED' ||
              statusRaw === 'ERROR' ||
              statusRaw === 'CANCELLED' ||
              statusRaw === 'CANCELED';

            const resultUrls: string[] = [];
            if (isSuccess) {
                findAllUrlsInObject(data, resultUrls);
            }

            return {
                taskId: node.taskId,
                status: statusRaw,
                isSuccess,
                isFailed,
                urls: Array.from(new Set(resultUrls)),
                raw: data
            };
        } catch (e) {
            console.warn(`Polling failed and will retry for task ${node.taskId}`, e);
            throw e; // Throw to trigger query retry logic
        }
      },
      refetchInterval: (query: any) => {
        const data = query.state.data;
        if (data && (data.isSuccess || data.isFailed)) return false;
        return 5000; // Poll every 5s (reduced from 3s to save requests)
      },
      retry: 3,
      enabled: !!node.taskId && (node.type === 'IMAGE' || !!apiKey)
    }))
  });

  // Track processed node-task pairs to avoid re-processing with a ref
  const processedTasksRef = useRef<Map<string, { success: boolean; failed: boolean }>>(new Map());

  // Effect to process results - single useEffect with proper dependencies
  useEffect(() => {
    queries.forEach((result) => {
        const data = result.data;
        if (!data || !data.taskId) return;

        // One task may map to multiple placeholders, so we route URL by node index.
        const targetNodes = pendingNodes.filter(n => n.taskId === data.taskId);
        if (!targetNodes.length) return;

        targetNodes.forEach((node) => {
          const processedKey = `${data.taskId}:${node.id}`;
          const processedState = processedTasksRef.current.get(processedKey) || { success: false, failed: false };

          // If success and not yet processed
          if (data.isSuccess && !processedState.success && data.urls.length > 0) {
               processedTasksRef.current.set(processedKey, { ...processedState, success: true });
               // Deterministic URL assignment per node under the same task.
               // 1st node -> urls[0], 2nd node -> urls[1], overflow -> last.
               const nodeIndex = targetNodes.findIndex(n => n.id === node.id);
               const urlIndex = Math.min(Math.max(nodeIndex, 0), data.urls.length - 1);
               const responseModel = String(data.raw?.properties?.model || data.raw?.model || "").toLowerCase();
               const isSingleNodeGrok = targetNodes.length === 1 && responseModel.startsWith('grok') && data.urls.length > 1;
               const selectedUrl = isSingleNodeGrok
                 ? data.urls[data.urls.length - 1]
                 : (data.urls[urlIndex] || data.urls[0]);
               console.log('[Polling Assign]', { taskId: data.taskId, nodeId: node.id, nodeIndex, urlIndex, isSingleNodeGrok, url: selectedUrl });
               onUpdateGeneration(node.id, selectedUrl);
           }
          // If failed and not yet processed
          else if (data.isFailed && !processedState.failed) {
               processedTasksRef.current.set(processedKey, { ...processedState, failed: true });
               let errorMsg = 'Generation Failed';
               const raw = data.raw;

             // Extract specific error details
             if (raw?.fail_reason) {
                 errorMsg = raw.fail_reason;
             } else if (raw?.data?.fail_reason) {
                 errorMsg = raw.data.fail_reason;
             } else if (raw?.error?.message) {
                 errorMsg = raw.error.message;
             } else if (typeof raw?.error === 'string') {
                 errorMsg = raw.error;
             } else if (raw?.result?.error) {
                 errorMsg = raw.result.error;
             } else if (raw?.data?.error) {
                 errorMsg = raw.data.error;
             }

             // Map backend errors to user-friendly advice (check immediately after extraction)
             let errorMapped = false;
             const errorMsgLower = String(errorMsg || '').toLowerCase();

             // Content policy rejection
             if (errorMsg.includes('Gemini could not generate an image with the given prompt')) {
                 errorMsg = '生成失败：提示词或参考图不符合 AI 伦理要求，请修改后重试';
                 errorMapped = true;
             }
             // Server overload / rate limit
             else if (
                errorMsgLower.includes('overloaded') ||
                errorMsgLower.includes('rate limit') ||
                errorMsgLower.includes('try again later')
             ) {
                 errorMsg = '当前算力紧张，服务排队中，请稍后重试';
                 errorMapped = true;
             }
             // Service unavailable / configuration issue
             else if (
                errorMsgLower.includes('no available channel') ||
                errorMsgLower.includes('contact admin')
             ) {
                 errorMsg = '服务暂时不可用，请稍后重试或联系管理员';
                 errorMapped = true;
             }

             // Handle Safety/Block reasons (Gemini/Vertex specific structure) - only if not already mapped
             if (!errorMapped) {
                 if (raw?.promptFeedback?.blockReason) {
                     errorMsg = `Blocked: ${raw.promptFeedback.blockReason}`;
                 } else if (raw?.candidates?.[0]?.finishReason && raw.candidates[0].finishReason !== 'STOP') {
                     errorMsg = `Stopped: ${raw.candidates[0].finishReason}`;
                     // Check safety ratings
                     const safety = raw.candidates[0].safetyRatings;
                     if (safety && Array.isArray(safety)) {
                         const unsafe = safety.find((r: any) => r.probability === 'HIGH' || r.probability === 'MEDIUM');
                         if (unsafe) {
                             errorMsg += ` (Safety: ${unsafe.category})`;
                         }
                     }
                 }
             }

               onUpdateGeneration(node.id, null, errorMsg);
               toastError(`${errorMsg}`);
          }
        });
    });

    // Clean up old processed tasks periodically (keep only last 50)
    if (processedTasksRef.current.size > 50) {
      const entries = Array.from(processedTasksRef.current.entries());
      processedTasksRef.current = new Map(entries.slice(-100));
    }
  }, [pendingNodes, queries.map(q => `${q.data?.taskId ?? ''}:${q.data?.status ?? ''}`).join(','), onUpdateGeneration, toastError]);

};
