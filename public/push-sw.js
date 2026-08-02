// Loaded into the Workbox-generated service worker via `workbox.importScripts`
// (see vite.config.ts) — this file is copied to dist/ verbatim, NOT processed
// by Vite/TypeScript/Babel, so keep it plain, dependency-free ES.

self.addEventListener("push", function (event) {
  var data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: "Anchor", body: event.data ? event.data.text() : "" }
  }

  var title = data.title || "Anchor"
  var options = {
    body: data.body || "",
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    tag: data.tag || "anchor-reminder",
    data: { url: data.url || "/" },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", function (event) {
  event.notification.close()
  var targetUrl = (event.notification.data && event.notification.data.url) || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i]
        var clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && "focus" in client) {
          if ("navigate" in client) client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
