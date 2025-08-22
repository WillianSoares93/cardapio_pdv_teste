// O nome do cache. Mude este valor sempre que atualizar os arquivos.
const CACHE_NAME = 'teste-v8'; // Um novo nome de cache para forçar a atualização

// Lista de arquivos a serem armazenados em cache.
const urlsToCache = [
  './',
  'index.html',
  'manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap',
  'https://raw.githubusercontent.com/WillianSoares93/catalogo_pizzaria/refs/heads/main/logo.png',
  'https://upload.wikimedia.org/wikipedia/commons/9/91/Pizza-3007395.jpg'
];

// Evento de Instalação: Onde o novo cache é criado e populado.
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aberto e arquivos sendo adicionados.');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Força o novo Service Worker a ativar assim que a instalação for concluída.
        return self.skipWaiting();
      })
  );
});

// Evento de Ativação: Onde o novo Service Worker assume o controle e limpa caches antigos.
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Se o nome do cache não for o atual, ele será deletado.
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Limpando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Assume o controle de todas as abas abertas imediatamente.
      console.log('Service Worker: Assumindo o controle dos clientes.');
      return self.clients.claim();
    })
  );
});

// Evento Fetch: Intercepta as requisições e serve do cache se disponível.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se a resposta estiver no cache, retorna ela.
        if (response) {
          return response;
        }
        // Caso contrário, busca na rede.
        return fetch(event.request);
      })
  );
});
