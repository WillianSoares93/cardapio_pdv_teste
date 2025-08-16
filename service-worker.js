const CACHE_NAME = 'teste-2';
const urlsToCache = [
  './',
  'index.html',
  'manifest.json',
  // 'https://cdn.tailwindcss.com', // Removido devido à política de CORS
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap',
  'https://raw.githubusercontent.com/WillianSoares93/catalogo_pizzaria/refs/heads/main/logo.png',
  // 'https://invexo.com.br/blog/wp-content/uploads/2022/12/pizza-pizzaria-gavea-rio-de-janeiro.jpg', // Removido devido à política de CORS
  'https://upload.wikimedia.org/wikipedia/commons/9/91/Pizza-3007395.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
