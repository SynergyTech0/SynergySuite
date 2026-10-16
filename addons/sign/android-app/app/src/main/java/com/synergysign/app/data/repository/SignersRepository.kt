package com.synergysign.app.data.repository

import com.synergysign.app.presentation.signers.Contact
import com.synergysign.app.presentation.signers.SignerGroup
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SignersRepository @Inject constructor() {
    
    private val contacts = mutableListOf<Contact>()
    private val groups = mutableListOf<SignerGroup>()
    
    suspend fun getContacts(): List<Contact> {
        return contacts.toList()
    }
    
    suspend fun getGroups(): List<SignerGroup> {
        return groups.toList()
    }
    
    suspend fun addContact(name: String, email: String) {
        val contact = Contact(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            email = email,
            documentsCount = 0
        )
        contacts.add(contact)
    }
    
    suspend fun updateContact(id: String, name: String, email: String) {
        val index = contacts.indexOfFirst { it.id == id }
        if (index >= 0) {
            contacts[index] = contacts[index].copy(name = name, email = email)
        }
    }
    
    suspend fun deleteContact(id: String) {
        contacts.removeAll { it.id == id }
    }
    
    suspend fun createGroup(name: String, memberIds: List<String>) {
        val members = contacts.filter { it.id in memberIds }
        val group = SignerGroup(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            members = members
        )
        groups.add(group)
    }
    
    suspend fun updateGroup(id: String, name: String, memberIds: List<String>) {
        val index = groups.indexOfFirst { it.id == id }
        if (index >= 0) {
            val members = contacts.filter { it.id in memberIds }
            groups[index] = groups[index].copy(name = name, members = members)
        }
    }
    
    suspend fun deleteGroup(id: String) {
        groups.removeAll { it.id == id }
    }
}
