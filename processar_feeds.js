const fs = require('fs');
const https = require('https');
const zlib = require('zlib'); // Necessário para ler sites modernos compressos

const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = ["Observador", "Mega Hits", "Notícias ao Minuto", "Vagalume", "SIC Notícias", "Papelpop", "Magazine HD", "RTP", "PopNow", "Renascença", "In Magazine", "Billboard", "NiT"];

// Função fetchUrl atualizada com suporte a GZIP (essencial para Lisboa Secreta e NiT)
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate', // Avisa o site que aceitamos dados compressos
                'Accept-Language': 'pt-PT,pt;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache'
            },
            timeout: 20000
        };

        https.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const newLoc = res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`;
                return fetchUrl(newLoc).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`Erro HTTP ${res.statusCode}`));
            }

            // Lógica para descompactar GZIP/DEFLATE se o site enviar
            let stream = res;
            const encoding = res.headers['content-encoding'];
            if (encoding === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (encoding === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            }

            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let text = buffer.toString('utf-8');
                
                // Se o XML indicar ISO-8859-1, recodifica
                if (text.includes('encoding="iso-8859-1"') || text.includes('encoding="windows-1252"')) {
                    text = buffer.toString('latin1');
                }
                resolve(text);
            });
        }).on('error', err => reject(err));
    });
}

function cleanText(txt) {
    if (!txt) return "";
    return txt.replace(/<!\[CDATA\[/gi, "").replace(/\]\]>/gi, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function getFav(url) {
    try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`; } catch (e) { return ""; }
}

async function processarFeed(feed) {
    try {
        console.log(`> A tentar: ${feed.n}`);
        const xmlRaw = await fetchUrl(feed.u);
        const xml = xmlRaw.replace(/^\uFEFF/, '').trim();
        
        // Regex flexível para capturar notícias em qualquer formato (RSS ou Atom)
        const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        const artigos = [];
        let match;
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 10) {
            const itemXml = match[2];
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let title = cleanText(titleMatch ? titleMatch[1] : "");
            if (!title) continue;

            // Tenta link padrão <link> ou link de atributo (Atom)
            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || itemXml.match(/href=["']([^"']+)["']/);
            let link = linkMatch ? (linkMatch[1] || linkMatch[0]).trim() : "";
            if (link.includes('href=')) {
                let m = link.match(/href=["']([^"']+)["']/);
                link = m ? m[1] : link;
            }

            const pubDateMatch = itemXml.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i);
            const pubDate = pubDateMatch ? new Date(pubDateMatch[2]) : new Date();

            let thumb = "";
            const tagsImg = itemXml.match(/<(?:media:content|enclosure|media:thumbnail)[^>]+>/gi);
            if (tagsImg) {
                for (const tag of tagsImg) {
                    const u = tag.match(/\burl\s*=\s*["']([^"'\s>]+)/i);
                    if (u && u[1] && u[1].length > 10) { thumb = u[1]; break; }
                }
            }

            artigos.push({
                t: title,
                l: link,
                i: thumb ? thumb.replace(/&amp;/g, "&") : "",
                p: pubDate.toISOString(),
                fav: getFav(feed.u),
                n: feed.n,
                c: feed.c
            });
            contador++;
        }
        console.log(`  [OK] ${artigos.length} notícias de ${feed.n}`);
        return artigos;
    } catch (e) {
        console.error(`  [ERRO] ${feed.n}: ${e.message}`);
        return [];
    }
}

async function ejecutar() {
    try {
        const fontesRaw = await fetchUrl(JSON_FEEDS_URL);
        const fontes = JSON.parse(fontesRaw);
        let todosArtigosPlanos = [];
        let gruposNoticias = [];

        for (const fonte of fontes) {
            const artigos = await processarFeed(fonte);
            if (artigos.length > 0) {
                todosArtigosPlanos = todosArtigosPlanos.concat(artigos);
                gruposNoticias.push({ nome: fonte.n, categoria: fonte.c, artigos });
            }
        }

        todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));
        gruposNoticias.sort((a, b) => {
            const idxA = priorityOrder.indexOf(a.nome);
            const idxB = priorityOrder.indexOf(b.nome);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });

        const resultado = {
            ultimasAtualizacao: new Date().toISOString(),
            fontesAtivas: fontes.filter(f => gruposNoticias.some(g => g.nome === f.n)),
            todosArtigosPlanos: todosArtigosPlanos,
            gruposPorPrioridade: gruposNoticias
        };

        fs.writeFileSync('noticias_final.json', JSON.stringify(resultado, null, 2));
        console.log("Processamento concluído com sucesso!");
    } catch (err) { console.error("Erro Fatal:", err); }
}
ejecutar();
