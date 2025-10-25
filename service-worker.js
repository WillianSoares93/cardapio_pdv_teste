// service-worker.js

// É importante mudar a versão do cache para que o navegador saiba que precisa atualizar.
const CACHE_NAME = 'testepdv-v3'; // Versão incrementada

// Lista de arquivos essenciais para o funcionamento offline do app.
// Removida a URL do Google Fonts para maior robustez.
const urlsToCache = [
  '/',
  'index.html',
  'manifest.json',
  'https://raw.githubusercontent.com/WillianSoares93/cardapio_samia/refs/heads/main/logo.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Evento de Instalação: Salva os arquivos essenciais no cache individualmente.
self.addEventListener('install', event => {
  // console.log('Service Worker: Instalando nova versão (v3)...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // console.log('Service Worker: Cache aberto (v3), salvando arquivos principais individualmente.');
        // Cria um array de promessas, uma para cada URL a ser cacheada
        const cachePromises = urlsToCache.map(url => {
          // Usa fetch individualmente com tratamento de erro
          return fetch(url)
            .then(response => {
              if (!response.ok) {
                // Se a busca falhar, lança um erro para impedir o cache da resposta ruim
                throw new Error(`Falha ao buscar ${url}: ${response.statusText}`);
              }
              // Se a busca for bem-sucedida, coloca a resposta no cache
              // console.log(`Service Worker: Cacheando ${url}`);
              return cache.put(url, response);
            })
            .catch(error => {
              // Loga o erro, mas não impede outros arquivos de serem cacheados
              // console.error(`Service Worker: Falha ao cachear ${url} - ${error.message}`);
              // Rejeita a promessa principal se algum arquivo essencial falhar.
              // Se preferir que a instalação continue mesmo com falhas (ex: logo opcional),
              // comente a linha abaixo e descomente a linha `return Promise.resolve();`
              return Promise.reject(error);
              // return Promise.resolve(); // Descomente para permitir instalação mesmo com falhas
            });
        });
        // Espera todas as operações individuais de cache terminarem
        return Promise.all(cachePromises);
      })
      .then(() => {
        // console.log('Service Worker: Arquivos principais cacheados com sucesso (ou falhas registradas).');
        return self.skipWaiting(); // Ativa o novo service worker imediatamente.
      })
      .catch(error => {
         // Captura qualquer rejeição do Promise.all (se algum arquivo essencial falhou)
         // console.error('Service Worker: Falha ao cachear um ou mais arquivos essenciais durante a instalação.', error);
         // Não chama skipWaiting() se a instalação falhou criticamente
      })
  );
});

// Evento de Ativação: Limpa os caches antigos para economizar espaço.
self.addEventListener('activate', event => {
  // console.log('Service Worker: Ativando nova versão (v3)...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            // console.log('Service Worker: Limpando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Garante que o novo service worker controle a página imediatamente.
  );
});

// Evento Fetch: Intercepta todas as requisições de rede GET http(s).
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignora requisições que não são GET ou de extensões do navegador.
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Estratégia Stale-While-Revalidate aprimorada.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      // 1. Tenta pegar do cache primeiro (Stale)
      return cache.match(request).then(cachedResponse => {
        // 2. Em paralelo, busca na rede (Revalidate)
        const fetchPromise = fetch(request).then(networkResponse => {
          // 3. Se a resposta da rede for válida, atualiza o cache
          if (networkResponse && networkResponse.ok) {
             // Clona a resposta para poder usar no cache e retornar ao navegador
             const responseToCache = networkResponse.clone();
             cache.put(request, responseToCache);
             // console.log(`Service Worker: Cache atualizado para ${request.url}`);
          } else if (networkResponse) {
             // Não cacheia respostas ruins (404, 500, etc.)
             // console.warn(`Service Worker: Resposta não OK da rede para ${request.url} (${networkResponse.status}), não cacheando.`);
          }
          return networkResponse; // Retorna a resposta da rede
        }).catch(error => {
            // Trata falha na rede (offline)
            // console.log(`Service Worker: Fetch falhou para ${request.url}; usando cache se disponível. Erro:`, error.message);
            // Se a rede falhar, a promessa é rejeitada, mas o `cachedResponse` (se existir) ainda pode ser usado.
            // Se não houver cache E a rede falhar, o erro será propagado.
             return Promise.reject(error); // Rejeita para indicar falha na rede
        });

        // Retorna a resposta do cache imediatamente se existir,
        // OU espera a resposta da rede se não houver cache.
        // Se a rede falhar (fetchPromise rejeitar) E tivermos cache, o cache ainda é retornado.
        return cachedResponse || fetchPromise;
      });
    })
  );
});

