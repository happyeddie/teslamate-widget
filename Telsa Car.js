// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: car-side;
const params = args.widgetParameter ? args.widgetParameter.split(",") : [];

const isDarkTheme = params?.[0] === 'dark';
const padding = 0;

{
 
  // https://lbs.amap.com/api/webservice/guide/create-project/get-key
  var AMAP_API_KEY = "";
  
  var TESLA_MATE_CAR_ID = 1;

  // https://github.com/tobiasehlert/teslamateapi
  var TESLA_MATE_API_URL = `http(s)://[TeslaMate Api URL]/api/v1/cars/${TESLA_MATE_CAR_ID}/status`;
  
  // https://github.com/adriankumpf/teslamate
  var TESLA_MATE_URL = "http(s)://[TeslaMate URL]"

  var DATA = {}

}

if (config.runsInApp) {
  let wv = new WebView();
  await wv.loadURL(TESLA_MATE_URL);
  
  for (var i = 1; i < 5; i++) {
    if ( i != TESLA_MATE_CAR_ID) {
      wv.evaluateJavaScript(`document.styleSheets[0].insertRule('#car_${i}, div.navbar-brand, footer {display: none}').insertRule('')`)
    }
  }
  
  wv.present(); 
  
  return;
}

let fm = FileManager.iCloud();
let fileRoot = fm.joinPath(fm.documentsDirectory(), "/tesla");
if(!fm.isDirectory(fileRoot)) {
  fm.createDirectory(fileRoot)
}

const widget = new ListWidget();
widget.setPadding(0, 0, 0, 0);
widget.backgroundColor = Color.black();
widget.refreshAfterDate = new Date(Date.now() + 1000 * 60 * 1);

function isLocationOutOfChina(latitude, longitude) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271)
    return true;
  return false;
}


function wgs2gcj(latitude, longitude) {
  var lat = "";
  var lon = "";
  var ee = 0.00669342162296594323;
  var a = 6378245.0;
  var pi = 3.14159265358979324;

  if (isLocationOutOfChina(latitude, longitude)) {
    lat = latitude;
    lon = longitude;
  }
  else {
    var adjustLat = transformLatWithXY(longitude - 105.0, latitude - 35.0);
    var adjustLon = transformLonWithXY(longitude - 105.0, latitude - 35.0);
    var radLat = latitude / 180.0 * pi;
    var magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    adjustLat = (adjustLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi);
    adjustLon = (adjustLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * pi);
    latitude = latitude + adjustLat;
    longitude = longitude + adjustLon;
  }
  return { latitude: latitude, longitude: longitude };

}

function transformLatWithXY(x, y) {
  var pi = 3.14159265358979324;
  var lat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  lat += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  lat += (20.0 * Math.sin(y * pi) + 40.0 * Math.sin(y / 3.0 * pi)) * 2.0 / 3.0;
  lat += (160.0 * Math.sin(y / 12.0 * pi) + 320 * Math.sin(y * pi / 30.0)) * 2.0 / 3.0;
  return lat;
}

function transformLonWithXY(x, y) {
  var pi = 3.14159265358979324;
  var lon = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  lon += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  lon += (20.0 * Math.sin(x * pi) + 40.0 * Math.sin(x / 3.0 * pi)) * 2.0 / 3.0;
  lon += (150.0 * Math.sin(x / 12.0 * pi) + 300.0 * Math.sin(x / 30.0 * pi)) * 2.0 / 3.0;
  return lon;
}


async function getCarData() {
  const url = `${TESLA_MATE_API_URL}`;
  let req = await new Request(url);
  return await req.loadJSON();
}

async function getCarGeo(lat, lng) {
  let geo = wgs2gcj(lat, lng)
  
  let filename = "";
  let file = null;
  
  let json;
  filename = `car_map_${car.id}.json`;
  file = fm.joinPath(fileRoot, filename);
  
  if (fm.fileExists(file)) {
    json = await fm.readString(file);
    json = JSON.parse(json);
    console.log("Read Geo From Disk");
  }
  
  if (json == null || car.car_geodata.latitude != car.prev_geodata.latitude) {
    // const url = `https://restapi.amap.com/v3/geocode/regeo?output=json&extensions=all&location=${geo.longitude},${geo.latitude}&key=${AMAP_API_KEY}`;
    // console.log(url)
    // let req = await new Request(url);
    // json = await req.loadString();
    let location = await Location.reverseGeocode(geo.latitude, geo.longitude, "zh-CN");
    json = JSON.stringify(location);
    fm.writeString(file, json);
    json = JSON.parse(json);
    console.log("Geo Written To Disk");
  }
	
  let image;
  let zoom = car.state === "driving" ? 14 : 14;
  filename = `car_map_${car.id}.png`;
  file = fm.joinPath(fileRoot, filename);    
	
  if (fm.fileExists(file)){
    image = await fm.readImage(file);
    console.log("Read Map From Disk");
  }

  
  if (image == null || car.car_geodata.latitude != car.prev_geodata.latitude) {
    let url = `https://restapi.amap.com/v3/staticmap?markers=small,0xFF0000,A:${geo.longitude},${geo.latitude}&zoom=${zoom}&size=150*150&key=${AMAP_API_KEY}`
    let req = await new Request(url);
    image = await req.loadImage();
    fm.writeImage(file, image);
    console.log("Map Written To Disk");
  }

  return await {
//    "geofence" : JSON.parse(json).regeocode.addressComponent.neighborhood.name,
    "geofence" : json[0].thoroughfare,
    "latitude" : geo.latitude,
    "longitude" : geo.longitude,
    "lat" : lat,
    "lng" : lng,
    "image" : image
  }
}

// Data Init
{
  
  var data = await getCarData();
  car = data.data.status;
  car.id = data.data.car.car_id;
  
  // load pre data
  let filename = `car_data_${car.id}.json`;
  let file = fm.joinPath(fileRoot, filename);
  
  if (fm.fileExists(file)) {
    let prevData = await fm.readString(file);
    prevData = JSON.parse(prevData);
    if (prevData) {
      car.prev_geodata = prevData.data.status.car_geodata;
    }
  }
  
  //car.state = "charging";
  //car.state = "driving"
  //car.prev_geodata.latitude = 1
  //car.driving_details.speed = 100;
  
  fm.writeString(file, JSON.stringify(data));
  
  if (car.state === "driving") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 60);
  }
  else if (car.state === "charging") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 20);
  }
  
  let geo = await getCarGeo(car.car_geodata.latitude, car.car_geodata.longitude)
  car.car_geodata = geo;
}


// Widget UI  

let layout = widget.addStack();
layout.layoutVertically();
//layout.setPadding(0, 0, 0, 0)

let main = layout.addStack();
main.layoutHorizontally();
//main.setPadding(0, 0, 0, 0)

let left = main.addStack();
left.layoutVertically();
left.size = new Size(190, 170)
left.setPadding(15, 25, 15, 25)

main.addSpacer(10)

let right = main.addStack();
right.layoutVertically();
right.size = new Size(170, 170)
right.setPadding(0, 0, 0, 0)


// Car Info
{
  
  let stack = left.addStack()
  stack.centerAlignContent();
  stack.setPadding(0, 0, 0, 0);
  stack.size = new Size(150, 20)
  
  // Car Name
  {
    let text = stack.addText(car.display_name + '                  ')
    text.font = Font.mediumSystemFont(16)
    text.lineLimit = 1;
    text.url=TESLA_MATE_URL
  }
  
  // Car State
  {
    stack.addSpacer(8)
    
    //car.state = "suspended";
    
    let symbol = null
    let color = Color.white();
    
    switch (car.state) {
      case "asleep": {
        symbol = SFSymbol.named("moon.circle");
        color = Color.gray();
        break;
      }
      case "suspended": {
        symbol = SFSymbol.named("parkingsign.circle");
        color = Color.white();
        break;
      }
      case "online": {
        symbol = SFSymbol.named("parkingsign.circle");
        color = Color.green();
        break;
      }
      case "driving": {
        symbol = SFSymbol.named("car.circle");
        color = Color.green();
        break;
      }
      case "charging": {
        symbol = SFSymbol.named("bolt.circle");
        color = Color.green();
        break;
      }
      case "offline": {
        symbol = SFSymbol.named("wifi.exclamationmark.circle");
        color = Color.red();
        break;
      }
      case "updating": {
        symbol = SFSymbol.named("arrow.up.circle");
        color = Color.yellow();
        break;
      }
      default: {
        console.log(car.state)
      }
    }
    
    // Sentry Mode
    if (car.car_status.sentry_mode === true) {
      symbol = SFSymbol.named("record.circle");
      color = Color.red()
    }
    
    if (symbol === null) {
      let text = stack.addText(car.state);
    }
    else {
      let img = stack.addImage(symbol.image);
      img.tintColor = color;
      img.imageSize = new Size(18, 18);
    }
  }
  
  stack.addSpacer(4)
  if (car.state === "driving") {
    let text = stack.addText(`${car.driving_details.speed}`)
    text.font = Font.mediumSystemFont(12)
    text.textColor = Color.green();
  }

}

// Battery Info
{
  
  left.addSpacer(15)
  
  let stack = left.addStack();
  stack.centerAlignContent();
  
  let height = 14;
  
  {
    
    let battery = new DrawContext();
    {
      battery.opaque = false;
      battery.size = new Size(50, 16);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, 42, height), 2, 2);
      path.addRoundedRect(new Rect(43, height / 4, 3, height / 2), 1, 1);
      battery.addPath(path)
      battery.setFillColor(car.state === "charging" ? Color.green() : Color.white());
      battery.fillPath();
    }
    
    {
      
      let width = (car.charging_details.charge_limit_soc - car.battery_details.battery_level) / 100 * 40;
      let x = car.battery_details.battery_level / 100 * 40 + 1;
      
      let draw = new DrawContext();
      draw.opaque = false;
      draw.size = new Size(42, height - 2);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, width, height - 2), 1, 1);
      draw.addPath(path)
      draw.setFillColor(car.state === "charging" ? Color.yellow() : Color.lightGray());
      draw.fillPath();
      
      battery.drawImageAtPoint(draw.getImage(), new Point(x, 1));
      battery.setFont(Font.mediumSystemFont(11))
      battery.setTextAlignedCenter();
      battery.setTextColor(Color.black());
      
      battery.drawText(`${car.battery_details.battery_level}`, new Point(14, 0))
      
    }
    
    {
      
      let width = (100 - car.charging_details.charge_limit_soc) / 100 * 40;
      
      let draw = new DrawContext();
      draw.opaque = false;
      draw.size = new Size(42, height - 2);
      let path = new Path();
      path.addRoundedRect(new Rect(0, 0, width, height - 2), 1, 1);
      draw.addPath(path)
      draw.setFillColor(Color.black());
      draw.fillPath();
      
      battery.drawImageAtPoint(draw.getImage(), new Point(41 - width, 1));
    }
    
    let image = stack.addImage(battery.getImage())
    image.imageSize = new Size(50, height)
  }
  
  {
    stack.addSpacer(5);
    stack.centerAlignContent();
    let km = `${car.battery_details.rated_battery_range}`.split('.')[0];
    let text = stack.addText(`${km}             `)
    text.textColor = car.state === "charging" ? Color.green() : Color.white();
    text.font = Font.mediumSystemFont(12)
    text.leftAlignText();
  }
  
  {
    let time = stack.addDate(new Date());
    time.size = new Size(30, 20)
    time.applyTimerStyle();
    time.minimumScaleFactor = 0.5
    time.font = Font.mediumSystemFont(12);
    time.lineLimit = 1;
    time.textColor = Color.gray();
    time.rightAlignText();
  }
  
}

// Charging Status
{
  if (car.state === "charging") {

    let time = Math.floor(car.charging_details.time_to_full_charge * 60);
    let hour = Math.floor(time / 60);
    let min  = time - hour * 60;
    let timeText = "";
    if (hour > 0) {
      timeText = `${hour}h`;
    }
    if (min > 0) {
      timeText = timeText + `${min}m`;
    }
    
    left.addSpacer(8)
    let line1 = left.addText(` ${car.charging_details.charger_power}kW → ${car.charging_details.charge_limit_soc}% · ${timeText}         `)
    line1.lineLimit = 1;
    line1.font = Font.mediumSystemFont(12)
    line1.textColor = Color.green();

  }
}

// Car Status
{
  left.addSpacer(15)
  
  let stack = left.addStack();
  
  let iconSize = new Size(20, 16);
  let spacerSize = 12;
  
  // Lock State
  {
    let symbol = null
    
    switch (car.car_status.locked) {
      case true: {
        symbol = SFSymbol.named("lock.fill");
        break;
      }
      default: {
        symbol = SFSymbol.named("lock.open.fill");
      }
    }
    
    let img = stack.addImage(symbol.image);
    img.tintColor = Color.white()
    img.imageSize = iconSize;
    img.rightAlignImage();
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("person.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.is_user_present === true ? Color.white() : Color.gray();
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("car.window.right");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.windows_open === true ? Color.white() : Color.gray();
    stack.addSpacer(spacerSize);
  }
  
  {
    let symbol = SFSymbol.named("fan.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.climate_details.is_climate_on === true ? Color.white() : Color.gray();
    stack.addSpacer(spacerSize); 
  }
  
  {
    let symbol = SFSymbol.named("car.top.door.front.left.and.front.right.and.rear.left.and.rear.right.open.fill");
    let img = stack.addImage(symbol.image);
    img.imageSize = iconSize;
    img.tintColor = car.car_status.doors_open === true ? Color.white() : Color.gray();
  }
}


// Location Info
{
  
  left.addSpacer(15)
 
  
  // Data Time
  {
    
    let stack = left.addStack();
    
    let text = stack.addText("")
  
    let desc = "long long ago"
    let time = new Date(car.state_since);
    let sec = Math.floor((new Date().getTime() - time.getTime()) / 1000);
    if (sec < 60) {
      desc = sec + 's';
    }
    else if (sec < 3600) {
      desc = Math.floor(sec / 60) + 'm';
    }
    else {
      desc = Math.floor(sec / 3600) + 'h';
    }

    text.text = desc + ' · ' + car.car_geodata.geofence
    text.font = Font.mediumSystemFont(12)
    text.textColor = Color.gray();
    text.lineLimit = 2;
    //text.url = `http://maps.apple.com/?ll=${car.car_geodata.latitude},${car.car_geodata.longitude}&q=` + encodeURI(car.display_name);
  }
  
  
}

// Map
{
  let stack = right.addStack();
  stack.setPadding(0, 0, 0, 0)
  {
    let image = stack.addImage(car.car_geodata.image)
    image.rightAlignImage();
    image.cornerRadius = 0;
    image.url = `http://maps.apple.com/?ll=${car.car_geodata.latitude},${car.car_geodata.longitude}&q=` + encodeURI(car.display_name);
  }
    
}

Script.setWidget(widget)
widget.presentMedium()
Script.complete();
  


