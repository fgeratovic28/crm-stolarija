import { useState, useEffect } from "react";

export function useSimulatedLoading(duration = 600) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), duration);
    return () => clearTimeout(t);
  }, [duration]);
  return loading;
}
