const fs = require('fs');
const https = require('https');

const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = ["Observador", "Mega Hits", "Notícias ao Minuto", "Vagalume", "SIC Notícias", "Papelpop", "Magazine HD", "RTP", "PopNow", "Renascença", "In Magazine", "Billboard", "NiT"];

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        // Correção para Lisboa Secreta: garantir que termina em /
        if (url.includes('lisboasecreta.co/feed') && !url.endsWith('/')) {
            url += '/';
        }

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Upgrade-Insecure-Requests': '1',
                'Referer': 'https://www.google.com/'
            },
            timeout: 20000,
            rejectUnauthorized: false 
        };

        https.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const newLoc = res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`;
                return fetchUrl(newLoc).then(resolve).catch(reject);
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let encoding = 'utf-8';
                const contentType = res.headers['content-type'] || '';
                if (contentType.toLowerCase().includes('iso-8859-1')) encoding = 'latin1';
                resolve(buffer.toString(encoding));
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
        console.log(`> A processar: ${feed.n}`);
        const xmlRaw = await fetchUrl(feed.u);
        const xml = xmlRaw.replace(/^\uFEFF/, '').trim();
        
        // Regex aprimorada para Lisboa Secreta e outros Atom/RSS
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
            let link = linkMatch ? (linkMatch[1] || "").trim() : "";
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
        console.log(`  [OK] ${artigos.length} artigos.`);
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
        console.log("Concluído!");
    } catch (err) { console.error("Erro fatal:", err); }
}
ejecutar();
