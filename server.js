const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// Render dynamically provides a PORT environment variable
const PORT = process.env.PORT || 3000;

app.post('/convert', (req, res) => {
    const videoUrl = req.body.url;
    if (!videoUrl) return res.status(400).send({ error: 'URL is required' });

    // Set headers to trigger an immediate file download in the browser
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Launch yt-dlp to download the video and pipe its output directly to stdout
    // We enforce h264+m4a configuration to ensure broad MP4 playability
    const ytdlp = spawn('yt-dlp', [
        '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', '-', 
        videoUrl
    ]);

    // Pipe the dynamic binary stream directly into the HTTP response
    ytdlp.stdout.pipe(res);

    // Handle unexpected errors gracefully
    ytdlp.stderr.on('data', (data) => {
        console.error(`yt-dlp log: ${data}`);
    });

    ytdlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`yt-dlp process exited with code ${code}`);
            if (!res.headersSent) {
                res.status(500).send({ error: 'Conversion failed' });
            }
        }
    });
});

app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
