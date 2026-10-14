import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoster,matchStudent} from '../lib/roster.mjs';
test('imports quoted names, BOM, and student IDs',()=>{assert.deepEqual(parseRoster('\uFEFFname,student_id\n"Morgan, Alex",S001\nJordan Lee,S002\n'),[{id:'1',name:'Morgan, Alex',code:'S001'},{id:'2',name:'Jordan Lee',code:'S002'}]);});
test('imports first and last names and headerless CSV',()=>{assert.equal(parseRoster('first_name,last_name\nAlex,Morgan')[0].name,'Alex Morgan');assert.equal(parseRoster('Alex Morgan\nJordan Lee').length,2);});
test('rejects duplicates and empty rosters',()=>{assert.throws(()=>parseRoster('name\nAlex\nalex'),/Duplicate/);assert.throws(()=>parseRoster('name\n'),/at least one/);});
test('requires student IDs for ambiguous names',()=>{const students=parseRoster('name,student_id\nAlex,S001\nAlex,S002');assert.equal(matchStudent(students,'Alex'),null);assert.equal(matchStudent(students,' s001 ').id,'1');assert.equal(matchStudent(students,'unknown'),null);});
