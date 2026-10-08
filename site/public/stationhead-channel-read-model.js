// One model instance per channel; adapters own their upstream API contracts.
import { buddiesModel } from './stationhead/buddies-read-model.js';
import { ohisamaModel } from './stationhead/ohisama-read-model.js';
import { nogizakaModel } from './stationhead/nogizaka-read-model.js';

const FACTORIES = { buddies: buddiesModel, ohisama: ohisamaModel, nogizaka: nogizakaModel };
const instances = new Map();

export function stationheadChannelReadModel(source = 'buddies') {
  const key = Object.hasOwn(FACTORIES, source) ? source : 'buddies';
  if (!instances.has(key)) instances.set(key, FACTORIES[key]());
  return instances.get(key);
}
