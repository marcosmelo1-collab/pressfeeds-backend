const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = ["Observador", "Mega Hits", "Notícias ao Minuto", "SIC Notícias", "Público", "RTP", "Renascença", "NiT", "Lisboa Secreta"];

function fetchUrl(url, redirectCount = 0) {
    if (redirectCount > 5) return Promise.reject(new Error('Demasiados redirecionamentos'));
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Encoding': 'gzip, deflate',
                'Referer': 'https://www.google.com/'
            },
            timeout: 15000 
        };

        const req = https.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const newLoc = res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`;
                return fetchUrl(newLoc, redirectCount + 1).then(resolve).catch(reject);
            }

            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') {
                const gunzip = zlib.createGunzip();
                res.pipe(gunzip);
                stream = gunzip;
            } else if (res.headers['content-encoding'] === 'deflate') {
                const inflate = zlib.createInflate();
                res.pipe(inflate);
                stream = inflate;
            }

            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let encoding = 'utf-8';
                if (url.includes('record.pt') || url.includes('abola.pt')) encoding = 'latin1';
                resolve(buffer.toString(encoding));
            });
            stream.on('error', err => reject(err));
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout 15s')); });
    });
}

function cleanText(txt) {
    if (!txt) return "";
    let str = txt.replace(/&lt;!\[CDATA\[|\]\]&gt;|CDATA\[|\]\]/gi, "");
    str = str.replace(/<[^>]+>/g, "");
    str = str.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    const mapa = { 'Ã³': 'ó', 'Ã§': 'ç', 'Ã£': 'ã', 'Ã©': 'é', 'Ã¡': 'á', 'Ã­': 'í', 'Ã¢': 'â', 'Ãª': 'ê', 'Ãµ': 'õ', 'Ãº': 'ú', 'Ã ': 'à', 'Âº': 'º' };
    for (let erro in mapa) { str = str.split(erro).join(mapa[erro]); }
    return str.replace(/\s+/g, " ").trim();
}

async function processarFeed(feed) {
    try {
        console.log(`> A ler: ${feed.n}`);
        const xml = await fetchUrl(feed.u);
        const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        const artigos = [];
        let match;
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 10) {
            const itemXml = match[2];
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let title = cleanText(titleMatch ? titleMatch[1] : "");
            if (!title) continue;

            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || itemXml.match(/href=["']([^"']+)["']/);
            let link = (linkMatch ? (linkMatch[1] || linkMatch[0]) : "").trim();
            if (link.includes('href=')) link = link.match(/href=["']([^"']+)["']/)[1];

            const pubDateMatch = itemXml.match(/<(pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/\1>/i);
            let dateVal = pubDateMatch ? new Date(pubDateMatch[2]) : new Date();
            if (isNaN(dateVal)) dateVal = new Date();

            // --- NOVO EXTRATOR DE IMAGENS ROBUSTO ---
            let thumb = "";
            
            // 1. Procura etiquetas estruturadas (url="..." ou href="...")
            const tagsImg = itemXml.match(/<(?:media:content|enclosure|media:thumbnail|image|webfeeds:featuredImage)[^>]+?\b(?:url|href)\s*=\s*["']([^"'\s>]+)/i);
            if (tagsImg && tagsImg[1] && tagsImg[1].length > 10 && !tagsImg[1].includes('favicon')) {
                thumb = tagsImg[1];
            }
            
            // 2. Se falhar, procura uma tag <img> dentro da descrição ou conteúdo
            if (!thumb) {
                const imgInText = itemXml.match(/<img[^>]+?\b(?:src|data-src)\s*=\s*["']([^"'\s>]+)/i);
                if (imgInText && imgInText[1] && imgInText[1].length > 10 && !imgInText[1].includes('favicon')) {
                    thumb = imgInText[1];
                }
            }

            artigos.push({
                t: title,
                l: link,
                i: thumb ? thumb.replace(/&amp;/g, "&").trim() : "",
                p: dateVal.toISOString(),
                fav: `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feed.u).hostname}`,
                n: feed.n.trim(),
                c: feed.c
            });
            contador++;
        }
        return artigos;
    } catch (e) {
        console.error(`  [FALHA] ${feed.n}: ${e.message}`);
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
                gruposNoticias.push({ nome: fonte.n.trim(), categoria: fonte.c, artigos });
            }
        }

        todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));
        gruposNoticias.sort((a, b) => {
            const idxA = priorityOrder.indexOf(a.nome), idxB = priorityOrder.indexOf(b.nome);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return idxA !== -1 ? -1 : (idxB !== -1 ? 1 : 0);
        });

        const resultado = {
            ultimasAtualizacao: new Date().toISOString(),
            fontesAtivas: fontes.filter(f => gruposNoticias.some(g => g.nome === f.n.trim())),
            todosArtigosPlanos,
            gruposPorPrioridade: gruposNoticias
        };

        fs.writeFileSync('noticias_final.json', JSON.stringify(resultado, null, 2));
        console.log("Concluído! Imagens otimizadas.");
    } catch (err) { console.error("Erro Fatal:", err); }
}
ejecutar();
