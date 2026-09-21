const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Main interactive UI Frontend
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>YouTube to MP4 Downloader</title>
        <style>
            body { font-family: sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { background: #1e1e1e; padding: 30px; border-radius: 8px; text-align: center; max-width: 400px; width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
            input { width: 90%; padding: 10px; margin: 15px 0; border: 1px solid #333; background: #2b2b2b; color: #fff; border-radius: 4px; }
            button { background: #ff0000; color: #fff; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 4px; width: 95%; }
            #status { margin-top: 15px; font-size: 13px; color: #bbb; line-height: 1.4; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>YouTube to MP4</h2>
            <input type="text" id="url" placeholder="Paste YouTube link here...">
            <button onclick="download()">Download Video</button>
            <div id="status"></div>
        </div>
        <script>
            async function download() {
                const url = document.getElementById('url').value.trim();
                const status = document.getElementById('status');
                if(!url) return alert('Please enter a URL');
                
                status.innerHTML = 'Processing video stream... <br><small style="color: #888;">Initial cloud processing can take 15-30 seconds.</small>';
                try {
                    const res = await fetch('/convert', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ url })
                    });
                    
                    if(!res.ok) {
                        const errorPayload = await res.json().catch(() => ({}));
                        throw new Error(errorPayload.error || 'Server processing failed.');
                    }
                    
                    status.innerText = 'Streaming file data directly to your device...';
                    const blob = await res.blob();
                    const a = document.createElement('a');
                    a.href = window.URL.createObjectURL(blob);
                    a.download = "video.mp4";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    status.innerHTML = '<span style="color:#00ff00;">Success! File downloaded.</span>';
                } catch(e) {
                    status.innerHTML = '<span style="color:#ff3333; font-weight:bold;">Error:</span> ' + e.message;
                }
            }
        </script>
    </body>
    </html>
    `);
});

// Stream Engine Extraction Pipeline
app.post('/convert', (req, res) => {
    const videoUrl = req.body.url;
    if (!videoUrl) return res.status(400).send({ error: 'URL required' });

    console.log(`[Engine]: Initiating stream compilation for ${videoUrl}`);

    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Refined extractor parameters to evade bot blockages and leverage mobile player endpoints
    const ytdlp = spawn('yt-dlp', [
        '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--extractor-args', 'youtube:player_client=ios,web_safari',
        '-o', '-', 
        videoUrl
    ]);

    ytdlp.stdout.pipe(res);

    let errorLog = "";
    ytdlp.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorLog += chunk;
        console.log(`[yt-dlp log]: ${chunk.trim()}`);
    });

    ytdlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`[Engine Error]: process exited with code ${code}`);
            if (!res.headersSent) {
                // If it is an obvious block or bot verification issue, forward it cleanly to the front end
                if (errorLog.includes("Sign in to confirm")) {
                    res.status(403).send({ error: 'YouTube blocked this cloud server IP. Try a shorter video or alternate link.' });
                } else {
                    res.status(500).send({ error: 'Extraction engine failed to parse this video configuration.' });
                }
            }
        }
    });

    req.on('close', () => {
        ytdlp.kill('SIGKILL');
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
