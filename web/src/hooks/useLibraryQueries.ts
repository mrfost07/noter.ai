import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { libraryEvents, libraryRequest } from "@/lib/meeting-library";
import useCurrentUser from "./useCurrentUser";

export const libraryKey = ["noter-library"] as const;
export function useLibrary() {
  const user = useCurrentUser();
  const client = useQueryClient();
  useEffect(() => {
    const update = () => void client.invalidateQueries({ queryKey: libraryKey });
    window.addEventListener(libraryEvents, update);
    return () => window.removeEventListener(libraryEvents, update);
  }, [client]);
  return useQuery({
    queryKey: [...libraryKey, user?.name],
    queryFn: () => libraryRequest(),
    enabled: !!user,
    staleTime: 5000,
    retry: false,
  });
}
