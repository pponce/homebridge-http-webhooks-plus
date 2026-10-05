const Util = require('../../Util');
const Constants = require('../../Constants');

function HttpWebHookCarbonDioxideSensorAccessory(ServiceParam, CharacteristicParam, platform, sensorConfig) {
  Service = ServiceParam;
  Characteristic = CharacteristicParam;

  this.platform = platform;
  this.log = Util.accessoryLog(platform, sensorConfig);
  this.storage = platform.storage;

  this.id = sensorConfig["id"];
  this.name = sensorConfig["name"];
  this.type = "co2";
  this.co2PeakLevel = sensorConfig["co2_peak_level"] || 1200;

  this.informationService = new Service.AccessoryInformation();
  this.informationService.setCharacteristic(Characteristic.Manufacturer, "HttpWebHooksPlatform");
  this.informationService.setCharacteristic(Characteristic.Model, "HttpWebHookCarbonDioxideSensorAccessory-" + this.name);
  this.informationService.setCharacteristic(Characteristic.SerialNumber, "HttpWebHookCarbonDioxideSensorAccessory-" + this.id);

  this.service = new Service.CarbonDioxideSensor(this.name);
  this.service.getCharacteristic(Characteristic.CarbonDioxideLevel).on('get', this.getCarbonDioxideLevel.bind(this));
  this.service.getCharacteristic(Characteristic.CarbonDioxideDetected).on('get', this.getCarbonDioxideDetected.bind(this));
}

HttpWebHookCarbonDioxideSensorAccessory.prototype.changeFromServer = function(urlParams) {
  var cached = this.storage.getItemSync("http-webhook-" + this.id) || 0;
  if (urlParams.value === undefined) {
    this.log.debug('Accessory state read or feedback received.');
    return {
      "success" : true,
      "state" : cached
    };
  }
  var urlValue = urlParams.value;
  var co2Detected = urlValue > this.co2PeakLevel;
  this.log.debug('Accessory state read or feedback received.');
  this.log.debug('Accessory state read or feedback received.');
  this.storage.setItemSync("http-webhook-carbon-dioxide-level-" + this.id, urlValue);
  this.storage.setItemSync("http-webhook-carbon-dioxide-detected-" + this.id, co2Detected);
  this.log.debug('Accessory state read or feedback received.');
  this.log.debug('Accessory state read or feedback received.');
  if (cached !== urlValue) {
    this.log('Accessory state event.');
    this.service.getCharacteristic(Characteristic.CarbonDioxideLevel).updateValue(urlValue, undefined, Constants.CONTEXT_FROM_WEBHOOK);
    this.service.getCharacteristic(Characteristic.CarbonDioxideDetected).updateValue(co2Detected ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL, undefined, Constants.CONTEXT_FROM_WEBHOOK);
  }
  return {
    "success" : true
  };
}

HttpWebHookCarbonDioxideSensorAccessory.prototype.getCarbonDioxideLevel = function(callback) {
  this.log.debug('Accessory state read or feedback received.');
  var temp = this.storage.getItemSync("http-webhook-carbon-dioxide-level-" + this.id);
  if (temp === undefined) {
    temp = 0;
  }
  callback(null, temp);
};

HttpWebHookCarbonDioxideSensorAccessory.prototype.getCarbonDioxideDetected = function(callback) {
    this.log.debug('Accessory state read or feedback received.');
    var state = this.storage.getItemSync("http-webhook-carbon-dioxide-detected-" + this.id);
    if (state === undefined) {
        state = false;
    }
    callback(null, state ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);
};

HttpWebHookCarbonDioxideSensorAccessory.prototype.getServices = function() {
  return [ this.service, this.informationService ];
};

module.exports = HttpWebHookCarbonDioxideSensorAccessory;
