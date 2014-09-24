var fs = require('fs'),
    path = require('path'),
    http = require('http'),
    unzip = require('unzip');

var log = function () {
    console.warn.apply(console, Array.prototype.concat.apply(['[Fetch Remote]'], arguments));
};

var FetchRemote = function (config) {
    config.commands.serve.option('force-fetch-remote', {help: 'Refetch overpass data even if local file exists [Default: false]', flag: true});
    config.beforeState('project:loaded', this.patchMML);
};

FetchRemote.prototype.patchMML = function (e) {
    if (!e.project.mml || !e.project.mml.Layer) return;
    var processed = 0, layer,
        length = e.project.mml.Layer.length,
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
    var download = function (layer) {
        incr();
        var uri = layer.Datasource.file,
            ext = path.extname(uri),
            basename = path.basename(uri),
            destDir = path.join(e.project.dataDir, layer.id),
            dest = path.join(destDir, basename);
        try {
            fs.mkdirSync(destDir);
        } catch (err) {}
        layer.Datasource.file = path.join(destDir, layer.id);
        log('New file for layer', layer.id, '=>', layer.Datasource.file);
        if(fs.existsSync(dest) && !force) {
            log('File already exists and not force mode', dest, 'SKIPPING');
            return decr();
        }
        var file = fs.createWriteStream(dest);
        var onDownloaded = function () {
            fs.createReadStream(dest)
              .pipe(unzip.Parse())
              .on('entry', function (entry) {
                var fileName = entry.path;
                log(fileName);
                if (entry.type === 'Directory') return entry.autodrain();
                if (layer.Datasource.type === "shape") fileName = layer.id + path.extname(fileName);
                entry.pipe(fs.createWriteStream(path.join(destDir, fileName)));
              }).on('close', decr);
        };
        var onError = function (err) {
            log('Error while fetching', uri);
            log(err.message);
            fs.unlink(dest);
            decr();
        };
        http.get(uri, function onResponse (resp) {
            resp.pipe(file);
            file.on('finish', function onFinish() {
                file.close(onDownloaded);
            });
        }).on('error', onError);
    };
    incr();
    for (var i = 0; i < e.project.mml.Layer.length; i++) {
        layer = e.project.mml.Layer[i];
        if (layer.Datasource && layer.Datasource.file && layer.Datasource.file.indexOf('http://') === 0) {  // https
            log('Processing file', layer.Datasource.file);
            download(layer);
        }
    }
    decr();
};

exports.Plugin = FetchRemote;
