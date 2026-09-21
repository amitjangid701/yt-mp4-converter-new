const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 1. Serve the interactive downloader UI directly on the home page route
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
            #status { margin-top: 15px; font-size: 13px; color: #bbb; }
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
                
                status.innerText = 'Processing video stream... Please wait.';
                try {
                    const res = await fetch('/convert', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ url })
                    });
                    if(!res.ok) throw new Error('Conversion failed.');
                    
                    status.innerText = 'Downloading file...';
                    const blob = await res.blob();
                    const a = document.createElement('a');
                    a.href = window.URL.createObjectURL(blob);
                    a.download = "video.mp4";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    status.innerText = 'Success!';
                } catch(e) {
                    status.innerText = 'Error processing video. Make sure it is a valid link.';
                }
            }
        </script>
    </body>
    </html>
    `);
});

// 2. The background engine conversion pipeline
app.post('/convert', (req, res) => {
    const videoUrl = req.body.url;
    if (!videoUrl) return res.status(400).send({ error: 'URL required' });

    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Run yt-dlp to stream output directly into response stdout
    const ytdlp = spawn('yt-dlp', [
        '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', '-', 
        videoUrl
    ]);

    ytdlp.stdout.pipe(res);

    ytdlp.on('close', (code) => {
        if (code !== 0 && !res.headersSent) {
            res.status(500).send({ error: 'Extraction failed' });
        }
    });

    req.on('close', () => {
        ytdlp.kill('SIGKILL');
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
