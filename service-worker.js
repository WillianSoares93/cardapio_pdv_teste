// O nome do cache. Mude este valor sempre que atualizar os arquivos para forçar a atualização.
const CACHE_NAME = 'samia-cardapio-v1.1'; 

// Lista de arquivos essenciais a serem armazenados em cache para o funcionamento offline.
const urlsToCache = [
  './', // A raiz do diretório, geralmente o index.html
  'index.html',
  'manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap',
  'https://raw.githubusercontent.com/WillianSoares93/cardapio_samia/refs/heads/main/logo.png',
  'https://raw.githubusercontent.com/WillianSoares93/cardapio_samia/refs/heads/main/imagem_fundo_cabe%C3%A7alho.jpg'
];

// Evento de Instalação: Onde o novo cache é criado e populado.
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  // waitUntil() garante que o service worker não será instalado até que o código dentro dele seja executado com sucesso.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aberto. Adicionando arquivos essenciais ao cache.');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Força o novo Service Worker a ativar assim que a instalação for concluída.
        // Isso é importante para que as atualizações sejam aplicadas imediatamente.
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
          // Se o nome do cache não for o atual, ele será deletado para economizar espaço.
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

// Evento Fetch: Intercepta as requisições de rede e serve do cache se disponível (estratégia Cache First).
self.addEventListener('fetch', event => {
  // Ignora requisições que não são GET (ex: POST para a API)
  if (event.request.method !== 'GET') {
    return;
  }

  // Ignora requisições para a API do Firebase para não interferir com o tempo real
  if (event.request.url.includes('firestore.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se a resposta estiver no cache, retorna ela.
        if (response) {
          return response;
        }
        // Caso contrário, busca na rede.
        return fetch(event.request).then(networkResponse => {
            // Opcional: Você pode adicionar lógica aqui para salvar novas requisições no cache dinamicamente.
            return networkResponse;
        });
      })
  );
});
