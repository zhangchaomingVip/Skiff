use super::*;

/// Provider-owned model. Legacy identities are read only compatibility aliases.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
	#[serde(flatten)]
	pub model: ModelSpec,
	#[serde(default)]
	pub family_id: String,
	#[serde(default = "default_true")]
	pub enabled: bool,
	#[serde(default = "default_true")]
	pub streaming: bool,
	#[serde(default = "default_true")]
	pub tools: bool,
	#[serde(default = "default_true")]
	pub reasoning: bool,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub legacy_route_ids: Vec<String>,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub legacy_provider_keys: Vec<String>,
}

fn merge(models: &mut Vec<ProviderModel>, incoming: ProviderModel, relay: &str) -> Result<(), String> {
	if let Some(existing) = models.iter_mut().find(|item| item.model.model_id == incoming.model.model_id) {
		let mut left = serde_json::to_value(&*existing).map_err(|_| "无法检查模型配置")?;
		let mut right = serde_json::to_value(&incoming).map_err(|_| "无法检查模型配置")?;
		for value in [&mut left, &mut right] {
			value.as_object_mut().unwrap().remove("legacyRouteIds");
			value.as_object_mut().unwrap().remove("legacyProviderKeys");
		}
		if left != right { return Err(format!("供应商 {relay} 的模型 {} 存在配置冲突；原配置已保留，请先统一旧模型配置", incoming.model.model_id)); }
		for id in incoming.legacy_route_ids { if !existing.legacy_route_ids.contains(&id) { existing.legacy_route_ids.push(id); } }
		for key in incoming.legacy_provider_keys { if !existing.legacy_provider_keys.contains(&key) { existing.legacy_provider_keys.push(key); } }
	} else { models.push(incoming); }
	Ok(())
}

/// Transactional in memory: callers only persist after the whole conversion validates.
pub fn migrate(config: &mut FamiliesConfig) -> Result<(), String> {
	let mut next = config.clone();
	for family in &next.families {
		for route in &family.routes {
			let relay = next.relays.iter_mut().find(|relay| relay.id == route.relay_id)
				.ok_or_else(|| format!("旧路线 {} 的供应商不存在，原配置已保留", route.id))?;
			for item in &route.models {
				let mut model = item.clone();
				model.vision = Some(item.vision.unwrap_or(route.vision));
				if model.thinking_levels.as_ref().is_none_or(|levels| levels.is_empty()) {
					model.thinking_levels = Some(if route.thinking_levels.is_empty() { vec!["minimal".into(), "low".into(), "medium".into(), "high".into()] } else { route.thinking_levels.clone() });
				}
				model = normalize_models(&[model])?.remove(0);
				let enabled = route.enabled && !relay.excluded_model_ids.contains(&model.model_id);
				merge(&mut relay.models, ProviderModel { model, family_id: family.id.clone(), enabled,
					streaming: route.streaming, tools: route.tools, reasoning: route.reasoning,
					legacy_route_ids: vec![route.id.clone()], legacy_provider_keys: vec![provider_key(&family.id, &relay.id)] }, &relay.name)?;
			}
		}
	}
	for relay in &mut next.relays {
		for model in std::mem::take(&mut relay.unassigned_models) {
			merge(&mut relay.models, ProviderModel { enabled: !relay.excluded_model_ids.contains(&model.model_id), model,
				family_id: String::new(), streaming: true, tools: true, reasoning: true,
				legacy_route_ids: vec![], legacy_provider_keys: vec![] }, &relay.name)?;
		}
		for entry in &mut relay.models {
			entry.model.max_tokens = usable_max_tokens(entry.model.max_tokens, entry.model.context_window);
		}
	}
	for family in &mut next.families { family.routes.clear(); }
	next.version = 6;
	next.auto_failover = false;
	next.auto_retry = false;
	*config = next;
	Ok(())
}

pub fn key(relay_id: &str) -> String { format!("{KEY_PREFIX}{}", sanitize_component(relay_id)) }

pub fn enabled<'a>(_config: &'a FamiliesConfig, relay: &'a RelaySpec) -> impl Iterator<Item = &'a ProviderModel> {
	relay.models.iter().filter(move |entry| relay.enabled && entry.enabled
		)
}

pub fn projection(entry: &ProviderModel, relay: &RelaySpec) -> Value {
	let item = &entry.model;
	let api = protocol_api(relay);
	let multiplier = relay.price_multiplier.unwrap_or(1.0);
	let mut compat = if api == "openai-completions" { json!({"supportsDeveloperRole": false}) } else { Value::Null };
	if api == "openai-completions" && entry.family_id == "deepseek" {
		compat["requiresReasoningContentOnAssistantMessages"] = json!(true);
		compat["thinkingFormat"] = json!("deepseek");
	}
	let defaults: Vec<String> = ["minimal", "low", "medium", "high"].iter().map(|value| value.to_string()).collect();
	let levels = item.thinking_levels.as_deref().unwrap_or(&defaults);
	let vision = item.vision.unwrap_or(false);
	let mut projected = json!({
		"id": item.model_id, "name": if item.alias.is_empty() { &item.model_id } else { &item.alias },
		"api": api, "provider": key(&relay.id), "streaming": entry.streaming, "tools": entry.tools,
		"cost": {"input": item.input_cost * multiplier, "output": item.output_cost * multiplier,
			"cacheRead": item.cache_read_cost * multiplier, "cacheWrite": item.cache_write_cost * multiplier},
		"currency": item.currency, "contextWindow": item.context_window, "maxTokens": usable_max_tokens(item.max_tokens, item.context_window),
		"input": if vision { vec!["text", "image"] } else { vec!["text"] },
		"reasoning": entry.reasoning, "compat": compat,
		"thinkingLevelMap": if entry.reasoning { Some(thinking_level_map(levels)) } else { None },
	});
	if vision {
		// Downscale oversized images as they enter pi's transcript; the request-size guard is the second line.
		projected["inputLimits"] = json!({"images": {"resize": {"maxWidth": 1568, "maxHeight": 1568, "maxBytes": 300000, "jpegQuality": 85}}});
	}
	projected
}

pub fn offers(config: &FamiliesConfig) -> Vec<RuntimeOffer> {
	let mut result = Vec::new();
	for relay in &config.relays {
		for entry in enabled(config, relay) {
			let item = &entry.model;
			let family = config.families.iter().find(|family| family.id == entry.family_id);
			let multiplier = relay.price_multiplier.unwrap_or(1.0);
			let levels = item.thinking_levels.clone()
				.unwrap_or_else(|| vec!["minimal".into(), "low".into(), "medium".into(), "high".into()]);
			result.push(RuntimeOffer {
				offer_id: format!("{}/{}", relay.id, item.model_id), route_id: String::new(), 
				family_id: entry.family_id.clone(), family_name: family.map(|family| family.display_name.clone()).unwrap_or_else(|| "未分组".into()),
				relay_id: relay.id.clone(), relay_name: relay.name.clone(), provider_key: key(&relay.id),
				model_id: item.model_id.clone(), alias: item.alias.clone(), billing_account_id: relay.billing_account_id.clone(),
				price_multiplier: relay.price_multiplier, streaming: entry.streaming, tools: entry.tools,
				vision: item.vision.unwrap_or(false), reasoning: entry.reasoning,
				thinking_levels: if entry.reasoning { ["off".into()].into_iter().chain(levels).collect() } else { vec!["off".into()] },
				input_cost: item.input_cost * multiplier, output_cost: item.output_cost * multiplier,
				cache_read_cost: item.cache_read_cost * multiplier, cache_write_cost: item.cache_write_cost * multiplier,
				currency: item.currency, max_tokens: usable_max_tokens(item.max_tokens, item.context_window), context_window: item.context_window,
				legacy_route_ids: entry.legacy_route_ids.clone(), legacy_provider_keys: entry.legacy_provider_keys.clone(),
			});
		}
	}
	result
}

pub fn save_relay_in(dir: &Path, relay: RelaySpec) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let mut relay = normalize_relay(relay, config)?;
		if let Some(previous) = config.relays.iter().find(|previous| previous.id == relay.id) {
			if relay.api_key.is_empty() { relay.api_key = previous.api_key.clone(); }
			for entry in &mut relay.models {
				if let Some(old) = previous.models.iter().find(|old| old.model.model_id == entry.model.model_id) {
					entry.legacy_route_ids = old.legacy_route_ids.clone();
					entry.legacy_provider_keys = old.legacy_provider_keys.clone();
				}
			}
		}
		upsert_relay(config, relay);
		Ok(())
	})
}
