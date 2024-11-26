// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: car-side;
const params = args.widgetParameter ? args.widgetParameter.split(",") : [];

const isDarkTheme = params?.[0] === 'dark';
const padding = 0;

{
 
  // https://lbs.amap.com/api/webservice/guide/create-project/get-key
  var AMAP_API_KEY = "";
  
  var TESLA_MATE_CAR_ID = params[0] || 1;

  // https://github.com/tobiasehlert/teslamateapi
  var TESLA_MATE_API_URL = `http(s)://[TeslaMate Api URL]/api/v1/cars/${TESLA_MATE_CAR_ID}/status`;
  
  // https://github.com/adriankumpf/teslamate
  var TESLA_MATE_URL = "http(s)://[TeslaMate URL]"

  var DATA = {}

}

let fm = FileManager.local();
let fileRoot = fm.joinPath(fm.documentsDirectory(), "/tesla");
if(!fm.isDirectory(fileRoot)) {
  fm.createDirectory(fileRoot)
}

const widget = new ListWidget();
widget.setPadding(0, 0, 0, 0);

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

if (config.runsInAccessoryWidget) {
  
  let filename = `car_data_${TESLA_MATE_CAR_ID}.json`;
  let file = fm.joinPath(fileRoot, filename);

  var data
  try {
    data = await getCarData();
  }
  catch (e) {
    console.log(e)
    let json = await fm.readString(file);
    data = JSON.parse(json);
  }
  
  car = data.data.status;
  
  {  
    let circle = new DrawContext();
    circle.size = new Size(100, 100);
    circle.opaque = false;
      
    circle.setStrokeColor(Color.black());
    circle.setLineWidth(10);
    circle.strokeEllipse(new Rect(5, 5, 90, 90));
      
    let power = car.battery_details.battery_level;
    circle.setFillColor(Color.white())
      
    let width = 8;
    for (let angle = 0; angle <= 360 / 100 * power; angle += 1) {
      let loc = calculateSidesLength(45, angle, 50)
      let rect = new Rect(loc[0] - width/2, loc[1] - width/2, width, width);
      circle.fillEllipse(rect);
    }
      
      
    circle.setTextColor(Color.white())
    circle.setFont(Font.regularMonospacedSystemFont(12))
    let offset = 0;
    let km = `${car.battery_details.rated_battery_range}`.split('.')[0];
    km = '88'
    if (km.length == 1) {
      offset = 8;
    }
    else if (km.length == 2) {
      offset = 4
    }
    //circle.drawText(km, new Point(39 + offset, 70))
      

    let iconData = Data.fromBase64String("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");
    if (car.state === "charging") {
      iconData = Data.fromBase64String("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");
    }
    
    circle.drawImageAtPoint(Image.fromData(iconData), new Point(30, 34))

    let image = widget.addImage(circle.getImage(iconData));
    image.borderWidth=0;
  }
    
  
    
  Script.setWidget(widget)
  widget.presentSmall()
  Script.complete();
  return;
}

//widget.backgroundColor = Color.black();
widget.backgroundColor = new Color("#292929", 100);

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
  filename = `car_map_${TESLA_MATE_CAR_ID}.json`;
  file = fm.joinPath(fileRoot, filename);
  
  if (fm.fileExists(file)) {
    json = await fm.readString(file);
    json = JSON.parse(json);
    console.log("Read Geo From Disk");
  }
  
  if (json == null || car.car_geodata.latitude != car.prev_geodata.latitude) {
    //const url = `https://restapi.amap.com/v3/geocode/regeo?output=json&extensions=all&location=${geo.longitude},${geo.latitude}&key=${AMAP_API_KEY}`;
    //let req = await new Request(url);
    //json = await req.loadString();
    
    try {
      let location = await Location.reverseGeocode(geo.latitude, geo.longitude, "zh-CN");
      json = JSON.stringify(location);
      
      //console.log(json)
      
      fm.writeString(file, json);
      json = JSON.parse(json);
      console.log("Write Geo To Disk");
    } catch (e) {}
  }
	
  let image;
  let zoom = car.state === "driving" ? 14 : 14;
  filename = `car_map_${TESLA_MATE_CAR_ID}.png`;
  file = fm.joinPath(fileRoot, filename);    
	
  if (fm.fileExists(file)){
    image = await fm.readImage(file);
    console.log("Read Map From Disk");
  }
  

  if (image == null || car.car_geodata.latitude != car.prev_geodata.latitude) {
    let url = `https://restapi.amap.com/v3/staticmap?scale=2&location=${geo.longitude},${geo.latitude}&zoom=${zoom}&size=150*150&key=${AMAP_API_KEY}`
    let req = await new Request(url);
    image = await req.loadImage();
    
    fm.writeImage(file, image);
    console.log("Write Map To Disk");
  }

  return await {
//    "geofence" : JSON.parse(json).regeocode.addressComponent.neighborhood.name,
    "geofence" : json?.regeocode?.pois[0]?.name || json[0]?.name || json[0]?.thoroughfare,
    "latitude" : geo.latitude,
    "longitude" : geo.longitude,
    "lat" : lat,
    "lng" : lng,
    "image" : image
  }
}

function calculateSidesLength(length, angle, size) {
      
    // 角度转换为弧度
    var angleA = 90;
    var angleB = 90 - angle;
    var angleC = angle;
    angleA = angleA * Math.PI / 180;
    angleB = angleB * Math.PI / 180;
    angleC = angleC * Math.PI / 180;

    // 使用正弦定理计算其他两边的长度
    var y = length * Math.sin(angleB) / Math.sin(angleA);
    var x = length * Math.sin(angleC) / Math.sin(angleA);
    
    return [size + parseInt(x.toFixed(0)), size - parseInt(y.toFixed(0))];
}

// Data Init
{
  
  // load pre data
  let filename = `car_data_${TESLA_MATE_CAR_ID}.json`;
  let file = fm.joinPath(fileRoot, filename);

  var data
  try {
    data = await getCarData();
  }
  catch (e) {
    console.log(e)
    let json = await fm.readString(file);
    data = JSON.parse(json);
  }
  
  car = data.data.status;
  
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
  
  if (car.state === "driving") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 10);
  }
  else if (car.state === "charging") {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 30);
  }
  else {
    widget.refreshAfterDate = new Date(Date.now() + 1000 * 60);
  }
  
  let geo = await getCarGeo(car.car_geodata.latitude, car.car_geodata.longitude)
  car.car_geo = geo;

  console.log("Write Data to Disk")
  fm.writeString(file, JSON.stringify(data));
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
  
  stack.addSpacer(3)
  
  // update available
  {
    if (car.car_versions.update_available) {
      let img = stack.addImage(SFSymbol.named("gift.circle").image);
      img.tintColor = Color.green();
      img.imageSize = new Size(18, 18);
    }
  }
  
  // Car State
  {
    //car.state = "suspended";
    
    // Tire
    {  
      if (car.tpms_details && (
        car.tpms_details.tpms_pressure_rl < 2.45 || 
        car.tpms_details.tpms_pressure_fl < 2.45 || 
        car.tpms_details.tpms_pressure_rr < 2.45 || 
        car.tpms_details.tpms_pressure_fr < 2.45
      )) {
        let symbol = SFSymbol.named("exclamationmark.tirepressure");
        let img = stack.addImage(symbol.image);
        img.tintColor = Color.yellow();
        img.imageSize = new Size(16, 16);
      }
    }
    
    stack.addSpacer(5)
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
      battery.setTextColor(car.state === "charging" ? Color.white() : Color.black());
      
      battery.drawText(`${car.battery_details.battery_level}`, new Point(14, 0))
      
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
    //img.url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name()) + '&ctrl=' + (car.car_status.windows_open === true ? 'window_close' : 'window_open');
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

    text.text = desc + ' · ' + car.car_geo.geofence
    text.font = Font.mediumSystemFont(12)
    text.textColor = Color.gray();
    text.lineLimit = 2;
    //text.url = `http://maps.apple.com/?ll=${car.car_geo.latitude},${car.car_geo.longitude}&q=` + encodeURI(car.display_name);
  }
  
  
}


// Map
{
  let stack = right.addStack();
  stack.setPadding(0, 0, 0, 0)
  {
    
    let map = new DrawContext();
    map.opaque = false;
    map.size = new Size(300, 300);
    map.drawImageAtPoint(car.car_geo.image, new Point(0, 0))
    
    let angle = car.driving_details.heading;
    let arrow = new DrawContext();
    arrow.size = new Size(40, 40);
    arrow.opaque = false;
    let size = 16;
    
    {
      let path = new Path();
      path.addLines([
        new Point(calculateSidesLength(20, angle, size)[0], calculateSidesLength(20, angle, size)[1]), 
        new Point(calculateSidesLength(20, angle + 130, size)[0], calculateSidesLength(20, angle + 130, size)[1]), 
        new Point(calculateSidesLength(8, angle + 180, size)[0], calculateSidesLength(8, angle + 180, size)[1]),      
        new Point(calculateSidesLength(20, angle - 130, size)[0], calculateSidesLength(20, angle - 130, size)[1]), 
      ]);
      arrow.addPath(path)
      arrow.setFillColor(Color.white());
      arrow.fillPath();
    }

    {
      let path = new Path();
      path.addLines([
        new Point(calculateSidesLength(14, angle, size)[0], calculateSidesLength(14, angle, size)[1]), 
        new Point(calculateSidesLength(14, angle + 130, size)[0], calculateSidesLength(14, angle + 130, size)[1]), 
        new Point(calculateSidesLength(4, angle + 180, size)[0], calculateSidesLength(4, angle + 180, size)[1]),      
        new Point(calculateSidesLength(14, angle - 130, size)[0], calculateSidesLength(14, angle - 130, size)[1]), 
      ]);
      arrow.addPath(path)
      arrow.setFillColor(Color.blue());
      arrow.fillPath();
    }
    
    map.drawImageAtPoint(arrow.getImage(), new Point(130, 130))
    
    let image = stack.addImage(map.getImage());
    image.rightAlignImage();
    image.cornerRadius = 0;
    image.url = `http://maps.apple.com/?ll=${car.car_geo.latitude},${car.car_geo.longitude}&q=` + encodeURI(car.display_name);
  }
    
}

Script.setWidget(widget)
widget.presentMedium()
Script.complete();