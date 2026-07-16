import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, StatusBar, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAgentStore } from '../store/callStore';
import { CountryPicker } from '../components/CountryPicker';
import { SimpleSelect } from '../components/SimpleSelect';
import { validatePhoneNumber, getCountryConfig } from '../utils/phoneValidator';
import { C, R, T } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';

const DEFAULT_SERVER = 'http://10.0.2.2:3001';
const FONCTIONS = ['Agent Acquisition', 'Agent EBU', 'Agent Frontoffice', 'Autre'];
const ZONES = ['Brazzaville', 'Pointe-Noire', 'Hinterland Nord', 'Hinterland Sud', 'Autre'];

export function AccountScreen({ navigation }: any) {
  const { numeroAgent, country, fonctionAgent, zoneAgent, serverUrl, setAgent, logout } = useAgentStore();
  const [form, setForm] = useState({
    numeroAgent: numeroAgent || '',
    country: country || 'CG',
    fonctionAgent: fonctionAgent || '',
    zoneAgent: zoneAgent || '',
    serverUrl: serverUrl || DEFAULT_SERVER,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      numeroAgent: numeroAgent || '',
      country: country || 'CG',
      fonctionAgent: fonctionAgent || '',
      zoneAgent: zoneAgent || '',
      serverUrl: serverUrl || DEFAULT_SERVER,
    });
  }, [numeroAgent, country, fonctionAgent, zoneAgent, serverUrl]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await AsyncStorage.multiGet(['kyc_numero', 'kyc_server', 'kyc_country', 'kyc_fonction', 'kyc_zone']);
      if (!mounted) return;
      const next = {
        numeroAgent: res.find(r => r[0] === 'kyc_numero')?.[1] || numeroAgent || '',
        country: res.find(r => r[0] === 'kyc_country')?.[1] || country || 'CG',
        fonctionAgent: res.find(r => r[0] === 'kyc_fonction')?.[1] || fonctionAgent || '',
        zoneAgent: res.find(r => r[0] === 'kyc_zone')?.[1] || zoneAgent || '',
        serverUrl: res.find(r => r[0] === 'kyc_server')?.[1] || serverUrl || DEFAULT_SERVER,
      };
      setForm(next);
    })();
    return () => { mounted = false; };
  }, []);

  const cfg = useMemo(() => getCountryConfig(form.country), [form.country]);
  const valid = useMemo(() => validatePhoneNumber(form.numeroAgent, form.country), [form.numeroAgent, form.country]);

  const handleSave = async () => {
    const clean = form.numeroAgent.replace(/\D/g, '');
    if (!clean) { setError('Le numéro est requis'); return; }
    if (!valid.isValid) { setError(valid.error || 'Numéro invalide'); return; }
    if (!form.fonctionAgent) { setError('Sélectionnez votre fonction'); return; }
    if (!form.zoneAgent) { setError('Sélectionnez votre zone'); return; }

    setLoading(true);
    setError('');
    setSaved(false);

    const normalizedServer = form.serverUrl.replace(/\/$/, '');
    await AsyncStorage.multiSet([
      ['kyc_numero', clean],
      ['kyc_server', normalizedServer],
      ['kyc_country', form.country],
      ['kyc_fonction', form.fonctionAgent],
      ['kyc_zone', form.zoneAgent],
    ]);

    setAgent({
      numeroAgent: clean,
      country: form.country,
      fonctionAgent: form.fonctionAgent,
      zoneAgent: form.zoneAgent,
      serverUrl: normalizedServer,
    });

    setLoading(false);
    setSaved(true);
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['kyc_numero', 'kyc_server', 'kyc_country', 'kyc_fonction', 'kyc_zone']);
    logout();
    navigation.replace('Login');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />
      <AppHeader title="Mon compte" subtitle="Profil agent" rightIcon="←" onRightPress={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.sectionTitle}>Informations enregistrées</Text>

          <Text style={s.label}>Pays</Text>
          <CountryPicker selectedCountry={form.country} onSelect={(value) => setForm({ ...form, country: value })} />

          <Text style={s.label}>Numéro WhatsApp</Text>
          <TextInput
            style={s.input}
            value={form.numeroAgent}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '');
              const maxLen = form.country === 'BJ' ? 10 : (cfg?.maxLength || 10);
              setForm({ ...form, numeroAgent: form.country === 'BJ' ? digits.slice(0, maxLen) : digits });
              setError('');
              setSaved(false);
            }}
            placeholder={form.country === 'BJ' ? '01XXXXXXXX' : (cfg?.placeholder || 'XXXXXXXX')}
            keyboardType="numeric"
            maxLength={form.country === 'BJ' ? 10 : (cfg?.maxLength || 10)}
          />
          {form.numeroAgent.length > 0 && (
            <Text style={[s.hint, { color: valid.isValid ? C.successText : C.dangerText }]}> 
              {valid.isValid ? '✓ Format valide' : valid.error}
            </Text>
          )}

          <View style={{ marginTop: 14 }}>
            <SimpleSelect label="Fonction" value={form.fonctionAgent} options={FONCTIONS} onSelect={(value) => { setForm({ ...form, fonctionAgent: value }); setSaved(false); }} />
          </View>

          <View style={{ marginTop: 14 }}>
            <SimpleSelect label="Zone" value={form.zoneAgent} options={ZONES} onSelect={(value) => { setForm({ ...form, zoneAgent: value }); setSaved(false); }} />
          </View>

          <Text style={s.label}>URL serveur</Text>
          <TextInput
            style={s.input}
            value={form.serverUrl}
            onChangeText={(value) => { setForm({ ...form, serverUrl: value }); setSaved(false); }}
            placeholder="https://kyc.example.com"
            autoCapitalize="none"
            keyboardType="url"
          />

          {error ? <Text style={s.error}>{error}</Text> : null}
          {saved ? <Text style={s.success}>Profil enregistré</Text> : null}

          <TouchableOpacity style={s.primaryBtn} onPress={handleSave} activeOpacity={0.9}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Enregistrer</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn} onPress={handleLogout} activeOpacity={0.9}>
            <Text style={s.secondaryBtnText}>Se déconnecter</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  container: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.bgBorder,
    padding: 18,
    shadowColor: '#0F1720',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionTitle: { fontSize: T.lg, fontWeight: '800', color: C.ink, marginBottom: 10 },
  label: { fontSize: T.sm, color: C.ink2, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: C.bgBorder,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: T.md,
    color: C.ink,
    backgroundColor: '#fff',
  },
  hint: { fontSize: T.xs, marginTop: 6, fontWeight: '600' },
  error: { marginTop: 12, color: C.dangerText, fontWeight: '700' },
  success: { marginTop: 12, color: C.successText, fontWeight: '700' },
  primaryBtn: {
    marginTop: 18,
    backgroundColor: C.blue,
    borderRadius: R.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: T.md, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.bgBorder,
    borderRadius: R.md,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  secondaryBtnText: { color: C.ink, fontSize: T.md, fontWeight: '700' },
});
