const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = ["Observador", "Mega Hits", "Notícias ao Minuto", "SIC Notícias", "Público", "RTP", "Renascença", "NiT", "Lisboa Secreta"];

async function traduzirTexto(texto) {
    if (!texto || texto.length < 3) return texto;
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
        const res = await fetchUrl(url, 0, 5000); 
        const json = JSON.parse(res);
        return json[0][0][0];
    } catch (e) { return texto; }
}

function fetchUrl(url, redirectCount = 0, customTimeout = 25000) {
    if (redirectCount > 5) return Promise.reject(new Error('Redirect Loop'));
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        let userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        if (url.includes('lisboasecreta') || url.includes('timeout') || url.includes('expresso') || url.includes('ratedrnb')) {
            userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
        }
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'close',
                'Cache-Control': 'no-cache'
            },
            timeout: customTimeout
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
                if (url.includes('record.pt') || url.includes('abola.pt') || url.includes('sapo.pt')) encoding = 'latin1';
                resolve(buffer.toString(encoding));
            });
        });
        req.on('error', err => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function cleanText(txt) {
    if (!txt) return "";
    let str = txt.replace(/&lt;!\[CDATA\[|\]\]&gt;|CDATA\[|\]\]/gi, "");
    str = str.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    const mapa = { 'Ã³': 'ó', 'Ã§': 'ç', 'Ã£': 'ã', 'Ã©': 'é', 'Ã¡': 'á', 'Ã­': 'í', 'Ã¢': 'â', 'Ãª': 'ê', 'Ãµ': 'õ', 'Ãº': 'ú', 'Ã ': 'à' };
    for (let erro in mapa) { str = str.split(erro).join(mapa[erro]); }
    return str.replace(/\s+/g, " ").trim();
}

// NOVO SISTEMA DE FAVICONS COLORIDOS E PRECISOS
function getColorfulFav(name, feedUrl) {
    let domain = "";
    try { domain = new URL(feedUrl).hostname; } catch(e) { domain = "google.com"; }
    
    // Correção para fontes com subdomínios ou nomes específicos
    const n = name.toLowerCase();
    if (n.includes("sic notícia")) domain = "sicnoticias.pt";
    else if (n.includes("expresso")) domain = "expresso.pt";
    else if (n.includes("público")) domain = "publico.pt";
    else if (n.includes("nit")) domain = "nit.pt";
    else if (n.includes("lisboa secreta")) domain = "lisboasecreta.co";
    else if (n.includes("mega hits")) domain = "megahits.fm";
    else if (n.includes("rolling stone")) domain = "rollingstone.com";
    
    return `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
}

async function processarFeed(feed) {
    try {
        const xml = await fetchUrl(feed.u);
        const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        const artigos = [];
        let match;
        let contador = 0;
        const colorfulFav = getColorfulFav(feed.n, feed.u);

        while ((match = itemRegex.exec(xml)) !== null && contador < 10) {
            const itemXml = match[2];
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let title = cleanText(titleMatch ? titleMatch[1] : "");
            if (!title) continue;
            if (feed.l === "en") title = await traduzirTexto(title);
            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || itemXml.match(/href=["']([^"']+)["']/);
            let link = (linkMatch ? (linkMatch[1] || linkMatch[0]) : "").trim();
            if (link.includes('href=')) link = link.match(/href=["']([^"']+)["']/)[1];
            const pubDateMatch = itemXml.match(/<(pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/\1>/i);
            let dateVal = pubDateMatch ? new Date(pubDateMatch[2]) : new Date();
            let thumb = "";
            const tagsImg = itemXml.match(/<(?:media:content|enclosure|media:thumbnail|image|webfeeds:featuredImage)[^>]+?\b(?:url|href|src)\s*=\s*["']([^"'\s>]+)/i);
            if (tagsImg) thumb = tagsImg[1];
            if (!thumb) {
                const imgInText = itemXml.match(/<img[^>]+?\b(?:src|data-src)\s*=\s*["']([^"'\s>]+)/i);
                if (imgInText) thumb = imgInText[1];
            }
            artigos.push({ t: title, l: link, i: thumb ? thumb.replace(/&amp;/g, "&").trim() : "", p: dateVal.toISOString(), fav: colorfulFav, n: feed.n.trim(), c: feed.c });
            contador++;
        }
        return artigos;
    } catch (e) { return []; }
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
        const resultado = { ultimasAtualizacao: new Date().toISOString(), fontesAtivas: fontes.filter(f => gruposNoticias.some(g => g.nome === f.n.trim())), todosArtigosPlanos, gruposPorPrioridade: gruposNoticias };
        fs.writeFileSync('noticias_final.json', JSON.stringify(resultado, null, 2));
        console.log("Sucesso!");
    } catch (err) { console.error("Erro Fatal:", err); }
}
ejecutar();
