const archiver = require('archiver');
const axios = require('axios');
const crypto = require('crypto');
const delay = require('delay');
const axiosCookieJarSupport = require('axios-cookiejar-support').wrapper;
const tough = require('tough-cookie');
const fs = require('fs').promises;
const fsOrig = require('fs');

const jar = new tough.CookieJar();
const http = axios.create({baseURL: '', withCredentials: true, jar});
axiosCookieJarSupport(http);
axios.defaults.withCredentials = true;

let regions = [
    { name: 'North Carolina USA', id: ['5168419a72c6a453c059baef6b58d3954140f00101f9012d6b03000000000092030e4e6f727468204361726f6c696e61'] },
];

const geoapifyKey = '5168419a72c6a453c059baef6b58d3954140f00101f9012d6b03000000000092030e4e6f727468204361726f6c696e61';
const usgsLogin = 'jaxonhackett';
const usgsPassword = 'Boada3131$12361215';


(async () => {
    await loginUSGS();

    let dataFormatId = await getDataFormat();

    try {
        await fs.mkdir('repo');
    } catch {}
    try {
        await fs.mkdir('release');
    } catch {}

    for(let region of regions) {
        console.log('Downloading '+region.name);

        let packName = 'DTED2-'+region.name+'.zip';
        let dataDirHash = crypto.randomBytes(16).toString('hex');
        let packUUID = crypto.randomUUID();
        let regionDir = 'release/'+region.name;
        let dataDir = regionDir+'/'+dataDirHash;
        let manifestDir = regionDir+'/MANIFEST';


        try {
            await fs.mkdir(regionDir)
        } catch {}
        try {
            await fs.mkdir(dataDir)
        } catch {}
        try {
            await fs.mkdir(manifestDir)
        } catch {}

        let manifestFiles = [];

        for(let id of region.id) {
            let files = await getFilesList(id);

            for(let file of files) {
                if(!(await downloadFile(file, dataFormatId)))
                    continue;

                let parts = file.split('/');
                let dir = dataDir+'/'+parts[1];

                try {
                    await fs.stat(dir);
                } catch {
                    await fs.mkdir(dir);
                }

                await fs.copyFile('repo/'+parts[1]+'/'+parts[0]+'.dt2', dir+'/'+parts[0]+'.dt2');
                manifestFiles.push(dataDirHash+'/'+parts[1]+'/'+parts[0]+'.dt2');
            }
        }

        console.log('Creating datapackage '+region.name);

        let manifestText = '<MissionPackageManifest version="2">\n' +
            '   <Configuration>\n' +
            '      <Parameter name="uid" value="'+packUUID+'"/>\n' +
            '      <Parameter name="name" value="'+packName+'"/>\n' +
            '   </Configuration>\n' +
            '   <Contents>\n';

        let manifestFilesSet = new Set(manifestFiles); //Remove duplicates

        for(let f of manifestFilesSet) {
            manifestText += '      <Content ignore="false" zipEntry="'+f+'"/>\n';
        }

        manifestText += '   </Contents>\n' +
            '</MissionPackageManifest>';

        await fs.writeFile(manifestDir+'/manifest.xml', manifestText);

        console.log('Packing datapackage '+region.name);


        const output = fsOrig.createWriteStream('release/'+packName);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        archive.pipe(output);
        archive.glob('**', {cwd:regionDir});

        await archive.finalize();
        await fs.rm(regionDir, { recursive: true, force: true })
    }

    console.log("Done");
    process.exit(0);




        // let box = [
        //     polygon[0][1], // Max Lat
        //     polygon[0][1], // Min Lat
        //     polygon[0][0], // Max Long
        //     polygon[0][0] // Min Long
        // ];
        //
        // for(let i = 0; i < polygon.length; i++) {
        //     let item = polygon[i];
        //
        //     if(box[0]<item[1])
        //         box[0] = item[1];
        //     else if(box[1]>item[1])
        //         box[1] = item[1];
        //
        //     if(box[2]<item[0])
        //         box[2] = item[0];
        //     else if(box[3]>item[0])
        //         box[3] = item[0];
        // }
        //
        // let boxPolygon = [
        //     [box[0], box[2]],
        //     [box[1], box[2]],
        //     [box[1], box[3]],
        //     [box[0], box[3]],
        // ];

        // let i = 0;
        // let coordinates = boxPolygon.map(e => {
        //     return {
        //         c: i++,
        //         a: e[0],
        //         o: e[1]
        //     };
        // });
        // let searchBox = {"tab":1,"destination":2,"coordinates":coordinates,"format":"dd","dStart":"","dEnd":"","searchType":"Std","includeUnknownCC":"1","maxCC":100,"minCC":0,"months":["","0","1","2","3","4","5","6","7","8","9","10","11"],"pType":"polygon"}
        //
        // let resSave = await http.post('https://earthexplorer.usgs.gov/tabs/save',  new URLSearchParams({ data: JSON.stringify(searchBox) }).toString());
        //
        // if(resSave.data!==1) {
        //
        //     console.error('Cannot save search data '+resSave.data);
        //     process.exit(1);
        // }
        //
        // let page = 1;
        // for(;;) {
        //     let searchData = {
        //         datasetId: dataId[1],
        //         resultsPerPage: 100,
        //         pageNum: page
        //     }
        //
        //     let resSearch = await http.post('https://earthexplorer.usgs.gov/scene/search', new URLSearchParams(searchData).toString());
        //
        //     // Proccess resSearch.data
        //
        //     let lastPage = resSearch.data.match(/<a id="(\d+)_([^"]+)" class="pageLink" tabindex="0" role="button">Last/i);
        //
        //     if(lastPage!==null) {
        //         console.error('Cannot get search page');
        //         process.exit(1);
        //     }
        //
        //     if(parseInt(lastPage[1], 10)<=page)
        //         break;
        //
        //     page++;
        // }


})();

async function getFilesList(region_id) {
    try {
        let resGeo = await http.get('https://api.geoapify.com/v2/place-details?id='+region_id+'&apiKey='+geoapifyKey);

        let polygons = resGeo.data.features[0].geometry.coordinates;
        if(resGeo.data.features[0].geometry.type==='MultiPolygon')
            polygons = Array.prototype.concat.apply([], polygons);

        let files = [];

        for(let polygon of polygons) {
            files = files.concat(getFilesFromPolygon(polygon));

            for(let point of polygon) { //Add polygon borders (for the small areas)
                files.push(getDTEDFile(point[1], point[0]))
            }
        }

        return new Set(files);
    }catch (e) {
        console.error('Cannot get region data: '+e.toString());
        process.exit(1);
    }
}

function getFilesFromPolygon(polygon) {
    let box = [
        polygon[0][1], // Max Lat
        polygon[0][1], // Min Lat
        polygon[0][0], // Max Long
        polygon[0][0] // Min Long
    ];

    let files = [];

    for(let i = 0; i < polygon.length; i++) {
        let item = polygon[i];

        if(box[0]<item[1])
            box[0] = item[1];
        else if(box[1]>item[1])
            box[1] = item[1];

        if(box[2]<item[0])
            box[2] = item[0];
        else if(box[3]>item[0])
            box[3] = item[0];
    }

    for(let lat = Math.floor(box[1]); lat <= Math.ceil(box[0]); lat++) {
        for(let lon = Math.floor(box[3]); lon <= Math.ceil(box[2]); lon++) {
            if(!isPointInPolygon([lon, lat], polygon, box))
                continue;

            files.push(getDTEDFile(lat, lon));
        }
    }

    return files;
}

// https://stackoverflow.com/questions/217578/how-can-i-determine-whether-a-2d-point-is-within-a-polygon
function isPointInPolygon(p, polygon, box) {
    if (p[1] < box[1] || p[1] > box[0] || p[0] < box[3] || p[0] > box[2]) {
        return false;
    }

    let isInside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if ( (polygon[i][0] > p[0]) !== (polygon[j][0] > p[0]) &&
            p[1] < (polygon[j][1] - polygon[i][1]) * (p[0] - polygon[i][0]) / (polygon[j][0] - polygon[i][0]) + polygon[i][1] ) {
            isInside = !isInside;
        }
    }

    return isInside;
}

async function downloadFile(file, dataFormatId) {
        let item = file.split('/');
        let outDir = 'repo/'+item[1];
        let outFile = outDir+'/'+item[0]+'.dt2';
        let fileId = 'SRTM1'+item[0].toUpperCase()+item[1].toUpperCase()+'V3';

        try {
            await fs.stat(outDir);
        } catch {
            await fs.mkdir(outDir);
        }

        try {
            await fs.stat(outFile);
            //Success
            console.log('Skipped '+outFile);
            return true;
        } catch {}


        console.log('Downloading file '+outFile);
        try {
            let resLink = await http.get('https://earthexplorer.usgs.gov/download/' + dataFormatId + '/' + fileId + '/', { responseType: 'arraybuffer'})
            // console.log(resLink);
            await fs.writeFile(outFile, resLink.data);

            await delay(100);
        } catch(e) {
            console.error('File '+outFile+' download error: '+e.toString());
            return false;
        }

        return true;
}

async function getDataFormat() {
    console.log('Receiving data format...');
    try {
        let resDataId = await http.get('https://earthexplorer.usgs.gov/dataset/categories');
        let dataId = resDataId.data.match(/for="coll_(.+?)">SRTM 1 Arc-Second Global<\/label>/i);

        if (dataId === null) {
            console.error('Cannot get data id');
            process.exit(1);
        }

        console.log('Data id: '+dataId[1]);

        let resDataFormatId = await http.get('https://earthexplorer.usgs.gov/scene/downloadoptions/'+dataId[1]+'/SRTM1N52E013V3');

        let resultFormatted = resDataFormatId.data.replace(/\r?\n|\r/g, '').replace(/( +)/ig, ' ');
        let dataFormatId = resultFormatted.match(/data-productId="([^"]+)" title="Download Product" >Download<\/button> <\/div> <div class="name"> DTED 1 Arc-second/i);

        if(dataFormatId===null) {
            console.error('Cannot get data format id');
            process.exit(1);
        }
        console.log('Data format id: '+dataFormatId[1]);

        return dataFormatId[1];
    } catch (e) {
        console.log('Data format error: '+e.toString());
        process.exit(1);
    }
}

async function loginUSGS() {
    console.log('Logging in...');
    try {
        let resCSRF = await http.get('https://ers.cr.usgs.gov/login');

        let csrf = resCSRF.data.match(/name="csrf" value="(.+?)"/i);

        if (csrf === null) {
            console.error('Cannot get CSRF token');
            process.exit(1);
        }

        let loginData = {
            username: usgsLogin,
            password: usgsPassword,
            csrf: csrf[1]
        }

        await http.post('https://ers.cr.usgs.gov/login', new URLSearchParams(loginData).toString()); // Will fail if httpCode != 200
    } catch (e) {
        console.log('Login error: '+e.toString());
        process.exit(1);
    }
}

// https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV/blob/1fb49280b8166fbb944dd1d7b6ddb748bfd2a257/atak/ATAK/app/src/main/java/com/atakmap/android/elev/dt2/Dt2FileWatcher.java#L228
function getDTEDFile(lat, lng) {
    let rLat = '';
    let rLng = '';

    let lngIndex = Math.abs(Math.floor(lng));
    rLng += lng < 0 ? "w" : "e";
    if (lngIndex < 10)
        rLng += "00";
    else if (lngIndex < 100)
        rLng += "0";
    rLng += lngIndex;



    let latIndex = Math.abs(Math.floor(lat));
    rLat += lat < 0 ? "s" : "n";
    if (latIndex < 10)
        rLat += "0";
    rLat += latIndex;


    return rLat+'/'+rLng;
}
