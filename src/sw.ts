/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any[] };
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("push", (event) => {
  let payload: any = {};
  try {
    payload = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title || "Отклик", {
      body: payload.body || "Твоя подборка готова",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "digest",
      data: { url: payload.url || "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(
        event.notification.data?.url || "/",
        self.location.origin,
      );
      if (url.origin !== self.location.origin) return;
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        await (client as WindowClient).navigate(url.href);
        await (client as WindowClient).focus();
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
