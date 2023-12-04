var express = require("express"); //Node.js的一个Web框架，可以用来快速构建Web应用程序
var moment = require("moment"); //JavaScript日期处理库，可以用来格式化和解析日期。
var http = require('http'); //Node.js的一个内置模块，可以用来创建HTTP服务器和客户端。
var request = require('request'); //Node.js的HTTP客户端库，可以用来发送HTTP请求和处理响应。
var fs = require('fs'); //Node.js的一个内置模块，可以用来读写文件和目录。
var Q = require('q'); //JavaScript的Promise库，可以用来处理异步操作。
var cors = require('cors'); //Node.js的中间件，可以用来处理跨域请求。

var app = express(); //构建Web应用程序
var port = process.env.PORT || 7000;


var baseDir = 'http://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';


// cors config
var whitelist = [
    'http://localhost:63342',
    'http://localhost:3000',
    'http://localhost:4000',
    'http://danwild.github.io'
];

var corsOptions = {
    //? origin: '*', // 允许所有域名访问API
    origin: function (origin, callback) {
        var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
        callback(null, originIsWhitelisted);
    }
};

app.listen(port, function (err) {
    console.log("running server on port " + port);
});
//  app.get('/user:id', function (req, res, next) {
//     console.log('ID:', req.params.id);
//     next();
// }, function (req, res, next) {
//     res.send('User Info')
// })

app.get('/', cors(corsOptions), function (req, res) {

    res.send('hello wind-js-server.. go to /latest for wind data..');

    // 如果请求不是跨域请求，req.headers.origin将返回undefined
    // console.log("🚀 ~ name:req.headers.origin ",req.headers.origin)
});

app.get('/alive', cors(corsOptions), function (req, res) {
    res.send('wind-js-server is alive');
});

app.get('/latest', cors(corsOptions), function (req, res) {

    /**
     * Find and return the latest available 6 hourly pre-parsed JSON data
     *
     * @param targetMoment {Object} UTC moment
     * 查找最新的风速数据文件并返回给客户端。
     * 如果当前时间点的数据文件不存在，则会尝试获取上一个时间点的数据文件，直到找到为止
     */
    function sendLatest(targetMoment) {

        var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
        var fileName = __dirname + "/json-data/" + stamp + ".json";

        res.setHeader('Content-Type', 'application/json');
        //将数据文件发送给客户端
        res.sendFile(fileName, {}, function (err) {
            if (err) {
                console.log(stamp + ' doesnt exist yet, trying previous interval..');
                sendLatest(moment(targetMoment).subtract(6, 'hours'));
            }
        });
    }

    sendLatest(moment().utc());

});

app.get('/nearest', cors(corsOptions), function (req, res, next) {

    var time = req.query.timeIso;
    var limit = req.query.searchLimit;
    var searchForwards = false;

    /**
     * Find and return the nearest available 6 hourly pre-parsed JSON data
     * If limit provided, searches backwards to limit, then forwards to limit before failing.
     *
     * @param targetMoment {Object} UTC moment
     */
    function sendNearestTo(targetMoment) {

        if (limit && Math.abs(moment.utc(time).diff(targetMoment, 'days')) >= limit) {
            if (!searchForwards) {
                searchForwards = true;
                sendNearestTo(moment(targetMoment).add(limit, 'days'));
                return;
            } else {
                return next(new Error('No data within searchLimit'));
            }
        }

        var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
        var fileName = __dirname + "/json-data/" + stamp + ".json";

        res.setHeader('Content-Type', 'application/json');
        res.sendFile(fileName, {}, function (err) {
            if (err) {
                var nextTarget = searchForwards ? moment(targetMoment).add(6, 'hours') : moment(targetMoment).subtract(6, 'hours');
                sendNearestTo(nextTarget);
            }
        });
    }

    if (time && moment(time).isValid()) {
        sendNearestTo(moment.utc(time));
    } else {
        return next(new Error('Invalid params, expecting: timeIso=ISO_TIME_STRING'));
    }

});

/**
 *
 * Ping for new data every 15 mins
 *
 */
setInterval(function () {

    run(moment.utc());

}, 900000);

/**
 *
 * @param targetMoment {Object} moment to check for new data
 */
function run(targetMoment) {
    getGribData(targetMoment).then(function (response) {
        if (response.stamp) {
            convertGribToJson(response.stamp, response.targetMoment);
        }
    });
}

/**
 *
 * Finds and returns the latest 6 hourly GRIB2 data from NOAAA
 *
 * @returns {*|promise}
 */
function getGribData(targetMoment) {

    var deferred = Q.defer();

    function runQuery(targetMoment) {

        // only go 2 weeks deep
        if (moment.utc().diff(targetMoment, 'days') > 30) {
            console.log('命中极限，收获完成或数据存在较大缺口。');
            return;
        }

        var stamp = moment(targetMoment).format('YYYYMMDD') + roundHours(moment(targetMoment).hour(), 6);
        var years = moment(targetMoment).format('YYYYMMDD')
        var hour = roundHours(moment(targetMoment).hour(), 6);
        request.get({
            url: baseDir,
            qs: {
                file: 'gfs.t' + roundHours(moment(targetMoment).hour(), 6) + 'z.pgrb2.1p00.f000',//指定需要获取的气象预报数据文件的文件名。在这里，文件名是由多个参数组成的字符串，包括GFS模型的起报时间、预报时效、数据格式等信息。
                lev_10_m_above_ground: 'on', //指定是否获取地面以上10米高度层的气象变量数据。这里设置为'on'，表示需要获取该高度层的数据。
                lev_surface: 'on', //指定是否获取地面高度层的气象变量数据。这里设置为'on'，表示需要获取该高度层的数据
                var_TMP: 'on', //指定是否获取温度（Temperature）气象变量的数据。这里设置为'on'，表示需要获取该气象变量的数据
                var_UGRD: 'on', //指定是否获取东西向风速（Eastward Wind）气象变量的数据。这里设置为'on'，表示需要获取该气象变量的数据
                var_VGRD: 'on', //指定是否获取南北向风速（Northward Wind）气象变量的数据。这里设置为'on'，表示需要获取该气象变量的数据
                leftlon: 0,//从0度经线开始 获取数据
                rightlon: 360,//到360度经线结束 获取数据
                toplat: 90, //到90度北纬结束 获取数据
                bottomlat: -90, //到90度南纬结束 获取数据
                dir: '/gfs.' + years + '/' + hour + '/atmos' //dir=%2Fgfs.20231127 %2F(转义：/) stamp:时间戳
            }

        }).on('error', function (err) {
            // console.log(err);
            runQuery(moment(targetMoment).subtract(6, 'hours'));

        }).on('response', function (response) {
            console.log("🚀 ~ name:response", response.request.url.href)
            console.log('响应状态：' + response.statusCode + ' 时间节点： ' + stamp);

            if (response.statusCode != 200) {
                runQuery(moment(targetMoment).subtract(6, 'hours'));
            } else {
                // don't rewrite stamps
                if (!checkPath('json-data/' + stamp + '.json', false)) {

                    console.log('piping ' + stamp);

                    // mk sure we've got somewhere to put output
                    checkPath('grib-data', true);

                    // pipe the file, resolve the valid time stamp
                    var file = fs.createWriteStream("grib-data/" + stamp + ".f000");
                    response.pipe(file);
                    file.on('finish', function () {
                        file.close();
                        deferred.resolve({stamp: stamp, targetMoment: targetMoment});
                    });

                } else {
                    console.log('already have ' + stamp + ', not looking further');
                    deferred.resolve({stamp: false, targetMoment: false});
                }
            }
        });

    }

    runQuery(targetMoment);
    return deferred.promise;
}

function convertGribToJson(stamp, targetMoment) {

    // mk sure we've got somewhere to put output
    checkPath('json-data', true);

    var exec = require('child_process').exec, child;

    child = exec('converter\\bin\\grib2json --data --output json-data\\' + stamp + '.json --names --compact grib-data\\' + stamp + '.f000',
        {maxBuffer: 500 * 1024},
        function (error, stdout, stderr) {

            if (error) {
                console.log('exec error: ' + error);
            } else {
                console.log("converted..");

                // don't keep raw grib data
                exec('rm grib-data/*');

                // if we don't have older stamp, try and harvest one
                var prevMoment = moment(targetMoment).subtract(6, 'hours');
                var prevStamp = prevMoment.format('YYYYMMDD') + roundHours(prevMoment.hour(), 6);

                if (!checkPath('json-data/' + prevStamp + '.json', false)) {

                    console.log("attempting to harvest older data " + stamp);
                    run(prevMoment);
                } else {
                    console.log('got older, no need to harvest further');
                }
            }
        });
}

/**
 *
 * Round hours to expected interval, e.g. we're currently using 6 hourly interval
 * i.e. 00 || 06 || 12 || 18
 *
 * @param hours
 * @param interval
 * @returns {String}
 */

function roundHours(hours, interval) {
    if (interval > 0) {
        var result = (Math.floor(hours / interval) * interval);
        return result < 10 ? '0' + result.toString() : result;
    }
}

/**
 * Sync check if path or file exists
 *
 * @param path {string}
 * @param mkdir {boolean} create dir if doesn't exist
 * @returns {boolean}
 */
function checkPath(path, mkdir) {
    try {
        fs.statSync(path);
        return true;

    } catch (e) {
        if (mkdir) {
            fs.mkdirSync(path);
        }
        return false;
    }
}

// init harvest
run(moment.utc());
