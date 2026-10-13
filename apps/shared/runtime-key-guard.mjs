import {createHash} from 'node:crypto';

function keyFingerprint(key){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))throw new Error('APP_MASTER_KEY_INVALID');
  return createHash('sha256').update('campus-runtime-key:v1:').update(Buffer.from(key,'hex')).digest('hex');
}

// Every server entry point checks this before constructing repositories or
// listening. Only the migration may create a marker; startup is read-only.
export async function assertRuntimeKey(client,key){
  const fingerprint=keyFingerprint(key);
  let saved;
  try{saved=await client.query('SELECT fingerprint FROM campus_runtime_key WHERE id=1');}
  catch(error){throw new Error(error.code==='42P01'?'APP_MASTER_KEY_NOT_INITIALIZED':'APP_KEY_CHECK_UNAVAILABLE');}
  if(!saved.rows.length)throw new Error('APP_MASTER_KEY_NOT_INITIALIZED');
  if(saved.rows[0].fingerprint!==fingerprint)throw new Error('APP_MASTER_KEY_CHANGED');
}

// Run inside the migration transaction/advisory lock. Do not automatically rotate
// this marker: a different key would invalidate ciphertext and account hashes.
export async function guardRuntimeKey(client,key){
  const fingerprint=keyFingerprint(key);
  const saved=await client.query('SELECT fingerprint FROM campus_runtime_key WHERE id=1 FOR UPDATE');
  if(saved.rows.length){
    if(saved.rows[0].fingerprint!==fingerprint)throw new Error('APP_MASTER_KEY_CHANGED');
    return;
  }
  const existing=await client.query('SELECT EXISTS(SELECT 1 FROM campus_identities) AS existing');
  if(existing.rows[0].existing)throw new Error('EXISTING_DATA_REQUIRES_KEY_MIGRATION');
  await client.query('INSERT INTO campus_runtime_key(id,fingerprint) VALUES(1,$1)',[fingerprint]);
}
