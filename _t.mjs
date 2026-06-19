import { parseStepTimestamps, mapStepsToTimestamps } from './src/lib/videoSource.js';
console.log('parse1', JSON.stringify(parseStepTimestamps("Mix at 0:15 then bake (1:30). Rest 12:05. Total 1:02:30. bad 1:75 ratio 90:00 price $1,200")));
console.log('parse empty', JSON.stringify(parseStepTimestamps(null, 3)));
console.log('parse dup', JSON.stringify(parseStepTimestamps("0:15 ... 0:15 ... 0:30")));
console.log('map inline', JSON.stringify(mapStepsToTimestamps(["Chop (0:10)","Cook","Plate"], parseStepTimestamps("0:05 0:20 0:40"))));
console.log('map none', JSON.stringify(mapStepsToTimestamps(["a","b"], null)));
console.log('map objs', JSON.stringify(mapStepsToTimestamps([{text:"step at 0:30"},{text:"x"}], [{seconds:5},{seconds:60}])));
