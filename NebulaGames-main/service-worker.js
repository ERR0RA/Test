const CACHE_NAME = 'nebula-shell-v1';
const APP_SHELL = ["./","./index.html","./manifest.json","./icon-192.png","./icon-512.png","./ai.html","./Ai2.html","./basketball.html","./biologyr13.html","./blockblast.html","./blockbreaker.html","./blockcraft.html","./Bot-Arena.html","./chemr13.html","./combined.html","./cricket.html","./Cricket2.html","./crossyroads.html","./Cyber-Strike.html","./drift.html","./eggshell.html","./elemental.html","./Fan.html","./football.html","./google77cf9045453af479.html","./Gravity-Slam.html","./index.html","./life.html","./masterarmory.html","./minesweeper.html","./Neon-Battle.html","./Neon-Defense.html","./Neon-Drift.html","./Neon-Golf.html","./Neon-Hex.html","./Neon-King.html","./Neon-Pong.html","./Neon-Reactor.html","./Neon-Slams.html","./Neon-Slash.html","./neon-trail.html","./overdrive.html","./pacman.html","./physicsr13.html","./reader.html","./Revise.html","./Shadow.html","./snake.html","./Solver.html","./spaceadventure.html","./sparksmaths.html","./sparxsmaths-log.html","./Star.html","./Test.html","./Theme.html","./tictactoe.html","./Three.js"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
