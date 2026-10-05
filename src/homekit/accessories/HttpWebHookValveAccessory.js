const Constants = require('../../Constants');
const Util = require('../../Util');

function HttpWebHookValveAccessory(ServiceParam, CharacteristicParam, platform, valveConfig) {
    Service = ServiceParam;
    Characteristic = CharacteristicParam;

    this.platform = platform;
    this.log = Util.accessoryLog(platform, valveConfig);
    this.storage = platform.storage;

    this.id = valveConfig["id"];
    this.name = valveConfig["name"];
    this.type = "valve";
    this.rejectUnauthorized = valveConfig["rejectUnauthorized"] === undefined ? true: valveConfig["rejectUnauthorized"] === true;
    this.onURL = valveConfig["on_url"] || "";
    this.onMethod = valveConfig["on_method"] || "GET";
    this.onBody = valveConfig["on_body"] || "";
    this.onForm = valveConfig["on_form"] || "";
    this.onHeaders = valveConfig["on_headers"] || "{}";
    this.offURL = valveConfig["off_url"] || "";
    this.offMethod = valveConfig["off_method"] || "GET";
    this.offBody = valveConfig["off_body"] || "";
    this.offForm = valveConfig["off_form"] || "";
    this.offHeaders = valveConfig["off_headers"] || "{}";

    this.informationService = new Service.AccessoryInformation();
    this.informationService.setCharacteristic(Characteristic.Manufacturer, "HttpWebHooksPlatform");
    this.informationService.setCharacteristic(Characteristic.Model, "HttpWebHookValveAccessory-" + this.name);
    this.informationService.setCharacteristic(Characteristic.SerialNumber, "HttpWebHookValveAccessory-" + this.id);

    var valveType = 0;
    switch(valveConfig.type) {
        default:
        case "generic valve":
            valveType = 0; // ValveType.GENERIC_VALVE
            break;
        case "irrigation":
            valveType = 1; // ValveType.IRRIGATION
            break;
        case "shower head":
            valveType = 2; // ValveType.SHOWER_HEAD
            break;
        case "water faucet":
            valveType = 3; // ValveType.WATER_FAUCET
            break;
    }

    this.service = new Service.Valve(this.name);
    this.service.setCharacteristic(Characteristic.ValveType, valveType);
    this.service.getCharacteristic(Characteristic.Active).on('get', this.getState.bind(this)).on('set', this.setState.bind(this));
    this.service.getCharacteristic(Characteristic.InUse).on('get', this.getState.bind(this)).on('set', this.setState.bind(this));
    this.service.getCharacteristic(Characteristic.StatusFault).on('get', this.getStatusFault.bind(this));

    this.category = 30;
}

HttpWebHookValveAccessory.prototype.changeFromServer = function(urlParams) {
    var cachedState = this.storage.getItemSync("http-webhook-" + this.id);
    if (cachedState === undefined) {
        cachedState = 0;
    }
    var cachedStatusFault = this.storage.getItemSync("http-webhook-" + this.id + "-statusFault");
    if (cachedStatusFault === undefined) {
        cachedStatusFault = 0;
    }
    if (!urlParams.state && !urlParams.statusFault) {
        return {
            "success" : true,
            "state" : cachedState,
            "statusFault" : cachedStatusFault
        };
    }
    else {
        if (urlParams.state) {
            var state = urlParams.state;
            var stateNumber = state === "true" ? 1 : 0;
            this.storage.setItemSync("http-webhook-" + this.id, stateNumber);
            this.log.info('Accessory state event.');

            if (cachedState !== stateNumber) {
                this.log('Accessory state event.');
                this.service.getCharacteristic(Characteristic.Active).updateValue(stateNumber, undefined, Constants.CONTEXT_FROM_WEBHOOK);
                this.service.getCharacteristic(Characteristic.InUse).updateValue(stateNumber, undefined, Constants.CONTEXT_FROM_WEBHOOK);
            }
        }
        if (urlParams.statusFault) {
            var statusFault = urlParams.statusFault;
            var statusFaultNumber = statusFault === "true" ? 1 : 0;
            this.storage.setItemSync("http-webhook-" + this.id + "-statusFault", statusFaultNumber);
            this.log.info('Accessory state event.');

            if (cachedStatusFault !== statusFaultNumber) {
                this.log('Accessory state event.');
                this.service.getCharacteristic(Characteristic.StatusFault).updateValue(statusFaultNumber, undefined, Constants.CONTEXT_FROM_WEBHOOK);
            }
        }
        return {
            "success" : true
        };
    }
};

HttpWebHookValveAccessory.prototype.getState = function(callback) {
    this.log.debug('Accessory state read or feedback received.');
    var state = this.storage.getItemSync("http-webhook-" + this.id);
    if (state === undefined) {
        state = 0;
    }

    callback(null, state);
};

HttpWebHookValveAccessory.prototype.getStatusFault = function(callback) {
    this.log.debug('Accessory state read or feedback received.');
    var statusFault = this.storage.getItemSync("http-webhook-" + this.id + "-statusFault");
    if (statusFault === undefined) {
        statusFault = 0;
    }

    callback(null, statusFault);
};

HttpWebHookValveAccessory.prototype.setState = function(active, callback, context) {
    this.log.info('Accessory state event.');
    this.storage.setItemSync("http-webhook-" + this.id, active);

    this.service.getCharacteristic(Characteristic.Active).updateValue(active, undefined, Constants.CONTEXT_FROM_WEBHOOK);
    this.service.getCharacteristic(Characteristic.InUse).updateValue(active, undefined, Constants.CONTEXT_FROM_WEBHOOK);

    var urlToCall = this.onURL;
    var urlMethod = this.onMethod;
    var urlBody = this.onBody;
    var urlForm = this.onForm;
    var urlHeaders = this.onHeaders;
    if (!active) {
        urlToCall = this.offURL;
        urlMethod = this.offMethod;
        urlBody = this.offBody;
        urlForm = this.offForm;
        urlHeaders = this.offHeaders;
    }

    Util.callHttpApi(this.log, urlToCall, urlMethod, urlBody, urlForm, urlHeaders, this.rejectUnauthorized, callback, context);
};

HttpWebHookValveAccessory.prototype.getServices = function() {
    return [ this.service, this.informationService ];
};

module.exports = HttpWebHookValveAccessory;
