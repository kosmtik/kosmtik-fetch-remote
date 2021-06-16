var fs = require('fs'),
    path = require('path'),
    unzip = require('unzipper');

function log() {
    console.warn.apply(console, Array.prototype.concat.apply(['[Fetch Remote]'], arguments));
};


class Fetch {
    constructor(config, layer, dataDir, callback) {
        this.config = config
        this.layer = layer
        this.callback = callback
        this.uri = layer.Datasource.file
        this.basename = path.basename(this.uri)
        this.destDir = path.join(dataDir, layer.id)
        this.dest = path.join(this.destDir, this.basename)
        try {
            fs.mkdirSync(this.destDir);
        } catch (err) {}
        layer.Datasource.file = this.dest
        this.patchLayer()
        log('New file for layer', layer.id, '=>', layer.Datasource.file)
    }

    patchLayer () {
        this.layer.Datasource.file = this.dest;
    }

    onDownloaded () {}

    onError (err) {
        log('Error while fetching', this.uri);
        log(err.message);
        fs.unlink(this.dest, this.callback);
    }

    onResponse (resp) {
        if (resp.statusCode >= 400) return this.onError(new Error('Bad status code: ' + resp.statusCode));
        var file = fs.createWriteStream(this.dest);
        resp.pipe(file);
        file.on('finish', () => {
            file.close();
            this.onDownloaded();
        });
    }


    download (force) {
        if(fs.existsSync(this.dest)) {
            if (!force) {
                log('File already exists and not force mode', this.dest, 'SKIPPING');
                return this.callback();
            }
            fs.unlinkSync(this.dest);
        }
        log("Downloading " + this.uri + " to " + this.dest);
        this.config.helpers.request({uri: this.uri}).on('error', this.onError.bind(this)).on('response', this.onResponse.bind(this));
    }

}


class FetchShp extends Fetch {

    patchLayer () {
        this.layer.Datasource.file = path.join(this.destDir, this.layer.id);
    }

    onDownloaded () {
        log("Processing " + this.dest);
        fs.createReadStream(this.dest)
        .pipe(unzip.Parse())
        .on('entry', (entry) => {
            var fileName = entry.path;
            log(fileName);
            if (entry.type === 'Directory') return entry.autodrain();
            if (this.layer.Datasource.type === 'shape') fileName = this.layer.id + path.extname(fileName);
            entry.pipe(fs.createWriteStream(path.join(this.destDir, fileName)));
        }).on('close', this.callback);
    }

}

class FetchRemote {
    constructor(config) {
        config.commands.serve.option('force-fetch-remote', {help: 'Refetch overpass data even if local file exists [Default: false]', flag: true});
        config.beforeState('project:loaded', this.patchMML);
    };

    patchMML(e) {
        if (!e.project.mml || !e.project.mml.Layer) return e.continue();
        var processed = 0, layer, klass, downloader,
            force = this.config.parsed_opts['force-fetch-remote'],
            incr = function () {
                processed++;
            },
            decr = function () {
                processed--;
                if (processed === 0) {
                    done();
                }
            },
            done = function () {
                log('Done.');
                e.continue();
            };
        incr();
        for (var i = 0; i < e.project.mml.Layer.length; i++) {
            layer = e.project.mml.Layer[i];
            if (layer.Datasource && layer.Datasource.file && layer.Datasource.file.search('^https?://') === 0) {
                log('Processing file', layer.Datasource.file);
                klass = downloaders[layer.Datasource.type] || Fetch
                downloader = new klass(this.config, layer, e.project.dataDir, decr)
                incr()
                downloader.download(force);
            }
        }
        decr();
    }
}

const downloaders = {
    "shape": FetchShp,
}

exports = module.exports = { Plugin: FetchRemote };
