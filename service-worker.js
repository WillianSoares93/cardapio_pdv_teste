// service-worker.js

// É importante mudar a versão do cache para que o navegador saiba que precisa atualizar.
const CACHE_NAME = 'samia-cardapio-v10'; 

// Lista de arquivos essenciais para o funcionamento offline do app.
const urlsToCache = [
  '/',
  'index.html',
  'manifest.json',
  'https://raw.githubusercontent.com/WillianSoares93/cardapio_samia/refs/heads/main/logo.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap'
];

// Evento de Instalação: Salva os arquivos essenciais no cache.
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando nova versão...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aberto, salvando arquivos principais.');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Ativa o novo service worker imediatamente.
  );
});

// Evento de Ativação: Limpa os caches antigos para economizar espaço.
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando nova versão...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Limpando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Garante que o novo service worker controle a página imediatamente.
  );
});

// Evento Fetch: Intercepta todas as requisições de rede.
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignora requisições que não são GET ou de extensões do navegador.
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Estratégia para a API do cardápio: Tenta a rede primeiro, se falhar, usa o cache.
  // Isso garante que o usuário sempre veja o cardápio mais recente possível, mas ainda funciona offline.
  if (request.url.includes('/api/menu')) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // Se a rede funcionou, salva a resposta no cache para uso offline.
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => {
          // Se a rede falhar, tenta pegar a resposta do cache.
          return caches.match(request);
        })
    );
    return;
  }

  // Estratégia Stale-While-Revalidate para todos os outros arquivos (CSS, imagens, fontes).
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(request).then(cachedResponse => {
        // 1. Retorna a resposta do cache imediatamente (Stale).
        const fetchPromise = fetch(request).then(networkResponse => {
          // 2. Em segundo plano, busca a versão mais recente na rede (Revalidate).
          cache.put(request, networkResponse.clone());
          return networkResponse;
        });

        // Retorna o que estiver no cache primeiro, e a busca na rede continua em segundo plano.
        return cachedResponse || fetchPromise;
      });
    })
  );
});
