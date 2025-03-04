import { freezeRouteRefresh, useDebugRouteHandling } from './DebugRouteSwitch';
import type { PiletRequester } from 'piral-base';
import type { EmulatorConnectorOptions } from './types';

export const debugRouteFilter = useDebugRouteHandling;

export function installPiletEmulator(requestPilets: PiletRequester, options: EmulatorConnectorOptions) {
  const { addPilet, removePilet, integrate, piletApiFallback = '/$pilet-api' } = options;

  // check if pilets should be loaded
  const loadPilets = sessionStorage.getItem('dbg:load-pilets') === 'on';
  const noPilets: PiletRequester = () => Promise.resolve([]);
  const requester = loadPilets ? requestPilets : noPilets;

  integrate(() => {
    const promise = requester();

    // the window['dbg:pilet-api'] should point to an API address used as a proxy, fall back to '/$pilet-api' if unavailable
    const piletApi = window['dbg:pilet-api'] || piletApiFallback;

    // either take a full URI or make it an absolute path relative to the current origin
    const initialTarget = /^https?:/.test(piletApi)
      ? piletApi
      : `${location.origin}${piletApi[0] === '/' ? '' : '/'}${piletApi}`;
    const updateTarget = initialTarget.replace('http', 'ws');
    const ws = new WebSocket(updateTarget);
    const timeoutCache = {};
    const timeout = 150;

    const appendix = fetch(initialTarget)
      .then((res) => res.json())
      .then((item) => (Array.isArray(item) ? item : [item]));

    ws.onmessage = ({ data }) => {
      const hardRefresh = sessionStorage.getItem('dbg:hard-refresh') === 'on';

      if (!hardRefresh) {
        // standard setting is to just perform an inject
        const meta = JSON.parse(data);
        const name = meta.name;

        // like a debounce; only one change of the current pilet should be actively processed
        clearTimeout(timeoutCache[name]);

        // some bundlers may have fired before writing to the disk
        // so we give them a bit of time before actually loading the pilet
        timeoutCache[name] = setTimeout(() => {
          // we should make sure to only refresh the page / router if pilets have been loaded
          const unfreeze = freezeRouteRefresh();

          // tear down pilet
          removePilet(meta.name)
            // load and evaluate pilet
            .then(() => addPilet(meta))
            // then disable route cache, should be zero again and lead to route refresh
            .then(unfreeze, unfreeze);
        }, timeout);
      } else {
        location.reload();
      }
    };

    return promise
      .catch((err) => {
        console.error(`Requesting the pilets failed. We'll continue loading without pilets (DEBUG only).`, err);
        return [];
      })
      .then((pilets) =>
        appendix.then((debugPilets) => {
          const debugPiletNames = debugPilets.map((m) => m.name);
          const feedPilets = pilets.filter((m) => !debugPiletNames.includes(m.name));
          return [...feedPilets, ...debugPilets];
        }),
      );
  });
}
