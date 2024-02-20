import mqtt from "mqtt";
import { Cron } from "croner";
import invariant from "invariant";

import runFastTest, { FastResult } from "./fast.js";

type SensorType =
  | "download_speed"
  | "upload_speed"
  | "latency"
  | "buffer_bloat";
const SENSOR_TYPE_TO_NAME = {
  download_speed: "Download Speed",
  upload_speed: "Upload Speed",
  latency: "Latency",
  buffer_bloat: "Buffer Bloat",
} as const;

function deviceClassForSensorType(sensorType: SensorType) {
  switch (sensorType) {
    case "download_speed":
    case "upload_speed":
      return "data_rate";
    case "latency":
    case "buffer_bloat":
      return null;
  }
}

function unitForSensorType(sensorType: SensorType) {
  switch (sensorType) {
    case "download_speed":
    case "upload_speed":
      return "Mbps";
    case "latency":
    case "buffer_bloat":
      return "ms";
  }
}

function iconForSensorType(sensorType: SensorType) {
  switch (sensorType) {
    case "download_speed":
      return "mdi:download";
    case "upload_speed":
      return "mdi:upload";
    case "latency":
      return "mdi:timer";
    case "buffer_bloat":
      return "mdi:timer-sand";
  }
}

function getDeviceIdentifier(identifier: string) {
  return `st_${identifier}`;
}

function getStateTopic(identifier: string) {
  const deviceIdentifier = getDeviceIdentifier(identifier);
  return `homeassistant/sensor/${deviceIdentifier}/state`;
}

async function publishSpeedTestResult(
  client: mqtt.MqttClient,
  identifier: string,
  result: SpeedTestResult
) {
  if (result.downloadSpeed < 5) {
    console.warn(
      `[st2mqtt] Download speed is less than 5 Mbps, skipping publishing`
    );
    return;
  }
  console.log(
    `[st2mqtt] Publishing speed test result to topic: ${getStateTopic(
      identifier
    )}`
  );
  await client.publishAsync(
    getStateTopic(identifier),
    JSON.stringify({
      download_speed: result.downloadSpeed,
      upload_speed: result.uploadSpeed,
      latency: result.latency,
      buffer_bloat: result.bufferBloat,
    })
  );
}

interface SpeedTestResult {
  downloadSpeed: number;
  uploadSpeed: number;
  latency: number;
  bufferBloat: number;
}

async function runSpeedTest(): Promise<SpeedTestResult> {
  return new Promise(async (resolve, reject) => {
    let result: FastResult | null = null;
    const observable = await runFastTest({ measureUpload: true });
    observable.subscribe({
      next: (value) => {
        result = value;
      },
      complete: () => {
        if (
          result != null &&
          result.downloadSpeed != null &&
          result.uploadSpeed != null &&
          result.latency != null &&
          result.bufferBloat != null
        ) {
          resolve({
            downloadSpeed: result.downloadSpeed,
            uploadSpeed: result.uploadSpeed,
            latency: result.latency,
            bufferBloat: Math.max(result.bufferBloat - result.latency, 0),
          });
        } else {
          reject(new Error("No result"));
        }
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

async function runAndReport(client: mqtt.MqttClient, identifier: string) {
  console.log("[st2mqtt] Starting speed test");
  const testResult = await runSpeedTest();
  console.log(`[st2mqtt] Speed test complete!`);
  console.log(`[st2mqtt]       Download: ${testResult.downloadSpeed} Mbps`);
  console.log(`[st2mqtt]         Upload: ${testResult.uploadSpeed} Mbps`);
  console.log(`[st2mqtt]        Latency: ${testResult.latency}`);
  console.log(`[st2mqtt]   Buffer Bloat: ${testResult.bufferBloat}`);
  await publishSpeedTestResult(client, identifier, testResult);
}

async function publishDiscoverMessage(
  client: mqtt.MqttClient,
  identifier: string,
  sensorType: SensorType
) {
  const deviceIdentifier = getDeviceIdentifier(identifier);
  const topic = `homeassistant/sensor/${deviceIdentifier}/${sensorType}/config`;
  const payload = {
    name: SENSOR_TYPE_TO_NAME[sensorType],
    state_topic: getStateTopic(identifier),
    device_class: deviceClassForSensorType(sensorType),
    unique_id: `${deviceIdentifier}_${sensorType}`,
    value_template: `{{ value_json.${sensorType} }}`,
    icon: iconForSensorType(sensorType),
    unit_of_measurement: unitForSensorType(sensorType),
    device: {
      name: "Speedtest Sensor",
      identifiers: [deviceIdentifier],
      manufacturer: "Vincent Riemer",
      model: "Speedtest Docker Container",
    },
  };
  console.log(`[st2mqtt] Publishing discovery message to ${topic}`);
  await client.publishAsync(topic, JSON.stringify(payload));
}

async function publishDiscoveryMessages(
  client: mqtt.MqttClient,
  identifier: string
) {
  await Promise.all([
    publishDiscoverMessage(client, identifier, "download_speed"),
    publishDiscoverMessage(client, identifier, "upload_speed"),
    publishDiscoverMessage(client, identifier, "latency"),
    publishDiscoverMessage(client, identifier, "buffer_bloat"),
  ]);
}

function createMessageHandler(client: mqtt.MqttClient, identifier: string) {
  return async (topic: string, message: Buffer) => {
    switch (topic) {
      case "homeassistant/status": {
        console.log(`[st2mqtt] Received "homeassistant/status" message`);
        await publishDiscoveryMessages(client, identifier);
      }
      default: {
        console.warn(`Received message on unknown topic: ${topic}`);
      }
    }
  };
}

function registerExitHandlers(cronJob: Cron, mqttClient: mqtt.MqttClient) {
  console.log("[st2mqtt] Registering exit handlers");
  process.on("beforeExit", () => {
    console.log("[st2mqtt] Cleaning up");
    cronJob.stop();
    mqttClient.end();
  });
  process.on("SIGHUP", () => process.exit(128 + 1));
  process.on("SIGINT", () => process.exit(128 + 2));
  process.on("SIGTERM", () => process.exit(128 + 15));
}

type ServerOptions = {
  mqttUsername?: string;
  mqttPassword?: string;
  cronSchedule?: string;
};
export default async function startServer(
  url: string,
  identifier: string,
  options: ServerOptions = {}
) {
  const {
    mqttUsername: username,
    mqttPassword: password,
    cronSchedule = "0 * * * *", // defaylts to once an hour
  } = options;

  // Connect to the mqtt broker
  const mqttClient = await mqtt.connectAsync(url, {
    username,
    password,
  });

  // Set up the message handler
  mqttClient.on("message", createMessageHandler(mqttClient, identifier));

  // Publish necessary messages on connect
  await publishDiscoveryMessages(mqttClient, identifier);

  // Run a speed test on start
  await runAndReport(mqttClient, identifier);

  // Subscribe to the topics we're interested in
  await mqttClient.subscribeAsync("homeassistant/status");

  // Set up the cron job
  console.log(`[st2mqtt] Setting up cron job with schedule: ${cronSchedule}`);
  const cronJob = Cron(cronSchedule, () => {
    console.log(`[st2mqtt] Triggered test by cron schedule`);
    runAndReport(mqttClient, identifier);
  });

  registerExitHandlers(cronJob, mqttClient);

  console.log("[st2mqtt] Server started!");
}

import { parseArgs } from "util";
if (import.meta.path === Bun.main) {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      mqtt_url: {
        type: "string",
        short: "m",
      },
      unique_id: {
        type: "string",
        short: "i",
      },
      mqtt_username: {
        type: "string",
        short: "u",
      },
      mqtt_password: {
        type: "string",
        short: "p",
      },
    },
    allowPositionals: true,
  });

  const { mqtt_url, unique_id, mqtt_username, mqtt_password } = values;
  invariant(mqtt_url, "Missing required option: --mqtt_url");
  invariant(unique_id, "Missing required option: --unique_id");

  startServer(mqtt_url, unique_id, {
    mqttUsername: mqtt_username,
    mqttPassword: mqtt_password,
  });
}
