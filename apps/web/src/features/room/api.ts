import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/keys';
import { panelLayout } from '@/features/panel/layout';
import sceneUrl from './assets/scene-v4.json?url';
import { buildRoomModel } from './model';
import { parseSceneAsset } from './scene/asset';

/**
 * The scene is a static file (about 380 KB gzipped) rather than part of the script: Vite gives it
 * a content-hashed name under `/assets/`, which nginx serves gzipped and cached for a year, and a
 * regenerated scene gets a new name, so no browser keeps an old one. Fetched once per page load.
 */
export function useRoomModel() {
  return useQuery({
    queryKey: queryKeys.room.scene(),
    queryFn: async ({ signal }) => {
      const response = await fetch(sceneUrl, { signal });
      if (!response.ok) throw new Error(`The room scene answered ${response.status}`);
      return buildRoomModel(parseSceneAsset(await response.json()), panelLayout);
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
