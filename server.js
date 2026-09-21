// Stream Engine Extraction Pipeline (Optimized for 512MB Free Tier)
app.post('/convert', (req, res) => {
    const videoUrl = req.body.url;
    if (!videoUrl) return res.status(400).send({ error: 'URL required' });

    console.log(`[Engine]: Initiating low-overhead stream for: ${videoUrl}`);

    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // EXPLANATION OF MODIFIED FLAGS:
    // "worst/best" fetches a single pre-merged stream to eliminate ffmpeg multiplexing crashes.
    // "--recode-video mp4" ensures it drops down to an mp4 wrapper seamlessly while streaming out.
    const ytdlp = spawn('yt-dlp', [
        '-f', 'best[ext=mp4]/worst[ext=mp4]/best', 
        '--no-cache-dir',
        '--extractor-args', 'youtube:player_client=tv,web_embedded,ios',
        '-o', '-', 
        videoUrl
    ]);

    // Forward the binary stdout chunks instantly to the browser
    ytdlp.stdout.pipe(res);

    let errorLog = "";
    ytdlp.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorLog += chunk;
        console.log(`[yt-dlp engine]: ${chunk.trim()}`);
    });

    ytdlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`[Engine Exit]: Core finished with failure status code ${code}`);
            if (!res.headersSent) {
                if (errorLog.includes("Sign in to confirm")) {
                    res.status(403).send({ error: 'YouTube bot protection triggered. Try another URL.' });
                } else if (errorLog.includes("403")) {
                    res.status(403).send({ error: 'Access Forbidden (HTTP 403) from YouTube.' });
                } else {
                    res.status(500).send({ error: 'Render out of memory. Try a shorter or lower resolution video.' });
                }
            }
        }
    });

    req.on('close', () => {
        ytdlp.kill('SIGKILL');
    });
});
