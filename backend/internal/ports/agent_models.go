package ports

// Model-discovery value types shared by the agent model-catalog surface.

// ChatModel is one provider model in a discovered catalog.
// The list comes from the provider, never from a table in AO. A hardcoded catalog
// is wrong within a week: models are added, renamed, hidden per account, and
// gated by entitlement the provider knows about and AO does not.
type ChatModel struct {
	ID          string
	DisplayName string
	Description string
	// Default marks the model the provider would pick on its own.
	Default bool
	// Efforts are the reasoning levels this model supports, in the provider's
	// order. Empty means the model does not take one.
	Efforts []string
	// DefaultEffort is the level the provider uses when none is chosen.
	DefaultEffort string
}

// ChatConfigOptionType is the interaction an advertised provider setting needs.
// Keeping both select and boolean in AO's vocabulary prevents protocol DTOs
// from leaking out of the adapter.
type ChatConfigOptionType string

const (
	// ChatConfigOptionSelect offers one value from provider-owned choices.
	ChatConfigOptionSelect ChatConfigOptionType = "select"
	// ChatConfigOptionBoolean offers a native on/off control.
	ChatConfigOptionBoolean ChatConfigOptionType = "boolean"
)

// ChatConfigOptionValue is the current or requested value for one provider
// setting. Exactly one field is meaningful according to the option's Type.
type ChatConfigOptionValue struct {
	Select  string
	Boolean *bool
}

// ChatConfigOptionChoice is one value in a select. Group fields preserve an
// agent's organization without making grouped menus a protocol concern above
// the adapter.
type ChatConfigOptionChoice struct {
	Value       string
	Name        string
	Description string
	Group       string
	GroupName   string
}

// ChatConfigOption is one live provider-owned session control.
//
// Category is a presentation hint (model, thought_level, mode, or a provider
// extension), never a correctness discriminator. Unknown categories must still
// render: that is how a newly released agent feature reaches AO without an AO
// release adding a new hardcoded setting.
type ChatConfigOption struct {
	ID          string
	Name        string
	Description string
	Category    string
	Type        ChatConfigOptionType
	Current     ChatConfigOptionValue
	Choices     []ChatConfigOptionChoice
}
