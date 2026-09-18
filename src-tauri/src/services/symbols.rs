use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, Node, StreamingIterator};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    pub name: String,
    pub kind: String, // "function", "class", "struct", "enum", "type", etc.
    pub start_line: usize,
    pub end_line: usize,
}

pub fn extract_symbols(file_path: &Path, content: &str) -> Vec<SymbolInfo> {
    let mut parser = Parser::new();
    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    
    let (language, query_str) = match ext {
        "rs" => {
            (
                tree_sitter_rust::LANGUAGE.into(),
                r#"
                (function_item name: (identifier) @name) @function
                (struct_item name: (type_identifier) @name) @struct
                (enum_item name: (type_identifier) @name) @enum
                (trait_item name: (type_identifier) @name) @trait
                (impl_item type: (type_identifier) @name) @impl
                "#
            )
        },
        "ts" | "tsx" => {
            // NOTE: for now we use typescript grammar for TS.
            (
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                r#"
                (function_declaration name: (identifier) @name) @function
                (class_declaration name: (type_identifier) @name) @class
                (interface_declaration name: (type_identifier) @name) @interface
                (type_alias_declaration name: (type_identifier) @name) @type
                "#
            )
        },
        "js" | "jsx" => {
             // For JS we can also use TS grammar as a fallback.
             (
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                r#"
                (function_declaration name: (identifier) @name) @function
                (class_declaration name: (identifier) @name) @class
                "#
            )
        }
        _ => return vec![], // unsupported language
    };

    parser.set_language(&language).expect("Error loading grammar");
    
    let tree = match parser.parse(content, None) {
        Some(tree) => tree,
        None => return vec![],
    };

    let query = match Query::new(&language, query_str) {
        Ok(q) => q,
        Err(_) => return vec![],
    };

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), content.as_bytes());

    let mut symbols = Vec::new();

    while let Some(m) = matches.next() {
        let mut name_node: Option<Node> = None;
        let mut item_node: Option<Node> = None;
        let mut kind = "unknown".to_string();

        for cap in m.captures {
            let cap_name = query.capture_names()[cap.index as usize];
            if cap_name == "name" {
                name_node = Some(cap.node);
            } else {
                item_node = Some(cap.node);
                kind = cap_name.to_string();
            }
        }

        if let (Some(item), Some(name)) = (item_node, name_node) {
            let symbol_name = &content[name.byte_range()];
            symbols.push(SymbolInfo {
                name: symbol_name.to_string(),
                kind,
                start_line: item.start_position().row + 1,
                end_line: item.end_position().row + 1,
            });
        }
    }

    symbols
}

pub fn handle(action: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    match action {
        "extract" => {
            let path_str = payload.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
            let path = Path::new(path_str);
            
            // Allow passing content directly, otherwise read from disk
            let content = if let Some(content_val) = payload.get("content").and_then(|v| v.as_str()) {
                content_val.to_string()
            } else {
                std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?
            };
            
            let symbols = extract_symbols(path, &content);
            serde_json::to_value(symbols).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown action: {}", action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_extract_rust_symbols() {
        let content = r#"
            pub struct MyStruct {}
            impl MyStruct {}
            pub fn my_function() {}
        "#;
        
        let symbols = extract_symbols(Path::new("test.rs"), content);
        assert_eq!(symbols.len(), 3);
        assert_eq!(symbols[0].name, "MyStruct");
        assert_eq!(symbols[0].kind, "struct");
        
        assert_eq!(symbols[1].name, "MyStruct");
        assert_eq!(symbols[1].kind, "impl");
        
        assert_eq!(symbols[2].name, "my_function");
        assert_eq!(symbols[2].kind, "function");
    }
}
