import { useEffect, useState, useCallback } from 'react';
import { agentApi } from '@/lib/agent';

interface ScanData {
  code: string;
  timestamp: Date;
}

export function useScanner(enabled: boolean = true) {
  const [lastScan, setLastScan] = useState<ScanData | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollScanner = useCallback(async () => {
    if (!enabled || !isPolling) return;

    try {
      const result = await agentApi.getLastScan();
      if (result && result.code) {
        const scanTime = new Date(result.time);
        
        // Only process if it's a new scan (within last 2 seconds)
        const now = new Date();
        const timeDiff = now.getTime() - scanTime.getTime();
        
        if (timeDiff < 2000) {
          setLastScan({
            code: result.code,
            timestamp: scanTime
          });
          
          // Clear the scan from agent
          await agentApi.clearLastScan();
        }
      }
    } catch (error) {
      console.error('Failed to poll scanner', error);
    }
  }, [enabled, isPolling]);

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    
    // Poll every 200ms when enabled
    const interval = setInterval(pollScanner, 200);
    
    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [enabled, pollScanner]);

  const clearScan = useCallback(() => {
    setLastScan(null);
  }, []);

  return {
    lastScan,
    clearScan,
    isPolling
  };
}

